// Android project hardening checks (node only; no Gradle / SDK needed).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { patchManifest, RULES_XML, PERMISSIONS } = require('../scripts/patch-android.js');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('--- Android hardening ---');

// patch-android.js on a freshly generated (Capacitor template) manifest.
const template = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;
const once = patchManifest(template);
assert.match(once, /android:allowBackup="false"/);
assert.doesNotMatch(once, /android:allowBackup="true"/);
assert.match(once, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
for (const p of PERMISSIONS) assert.strictEqual(once.split(`android.permission.${p}"`).length - 1, 1, `${p} present once`);
assert.strictEqual(patchManifest(once), once, 'idempotent');
assert.match(patchManifest(template.replace('android:allowBackup="true"\n        ', '')), /android:allowBackup="false"/, 'adds the attribute if missing');
assert.ok(/<cloud-backup>[\s\S]*<device-transfer>/.test(RULES_XML) && (RULES_XML.match(/<exclude /g) || []).length === 10, 'rules exclude all domains');

// The real project.
const manifest = read('android/app/src/main/AndroidManifest.xml');
assert.match(manifest, /android:allowBackup="false"/, 'manifest: allowBackup=false');
assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
assert.strictEqual(patchManifest(manifest), manifest, 'manifest is already patched');
assert.strictEqual(read('android/app/src/main/res/xml/data_extraction_rules.xml'), RULES_XML);
assert.match(read('package.json'), /"android:sync": "[^"]*patch-android\.js/, 'android:sync re-applies the patch');

// Package rename: no template package left; package lines match folders.
const javaFiles = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.java') && javaFiles.push(p); } })(path.join(ANDROID, 'app/src'));
assert.ok(javaFiles.length >= 3);
for (const f of javaFiles) {
  const src = fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(src, /com\.getcapacitor\.myapp|com\.getcapacitor\.app/, `${f}: template package`);
  const pkg = src.match(/^package ([\w.]+);/m)[1];
  assert.strictEqual(pkg, 'com.qflow.sih26137', `${path.relative(ROOT, f)}: package`);
  assert.ok(f.includes(path.join('java', ...pkg.split('.'))), `${path.relative(ROOT, f)}: folder matches package`);
}
assert.match(read('android/app/src/androidTest/java/com/qflow/sih26137/ExampleInstrumentedTest.java'), /assertEquals\("com\.qflow\.sih26137", appContext\.getPackageName\(\)\)/);

// Release signing: read from git-ignored keystore.properties, no secrets in the repo.
const gradle = read('android/app/build.gradle');
assert.match(gradle, /rootProject\.file\('keystore\.properties'\)/);
assert.match(gradle, /signingConfigs\s*\{\s*release\s*\{/);
assert.match(gradle, /signingConfig signingConfigs\.release/);
assert.doesNotMatch(gradle, /(storePassword|keyPassword)\s+['"]/, 'no hard-coded passwords');
const ignore = read('.gitignore').split('\n').map((l) => l.trim());
for (const p of ['android/keystore.properties', '*.jks', '*.keystore', 'local.properties', '*.apk']) assert.ok(ignore.includes(p), `.gitignore has ${p}`);
const example = read('android/keystore.properties.example');
assert.match(example, /^storePassword=\s*$/m, 'example has no password');
assert.match(example, /^keyPassword=\s*$/m, 'example has no password');
const keyFiles = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { if (f === 'node_modules' || f === '.git') continue; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(jks|keystore)$|^keystore\.properties$/.test(f) && keyFiles.push(p); } })(ROOT);
assert.deepStrictEqual(keyFiles, [], 'no keystore or keystore.properties in the project');

console.log(`✓ allowBackup=false + dataExtractionRules (idempotent patch), package renamed in ${javaFiles.length} Java files, release signing from git-ignored keystore.properties, no keys in the project.`);
