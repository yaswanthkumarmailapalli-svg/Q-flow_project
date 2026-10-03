// Builds an APK via Gradle (needs JDK 17 + Android SDK, both bundled with Android Studio).
//   node scripts/build-apk.js            -> debug APK (debug key)
//   node scripts/build-apk.js --release  -> release APK, signed if android/keystore.properties exists
const { spawnSync } = require('child_process'), path = require('path'), fs = require('fs'), win = process.platform === 'win32';
const release = process.argv.includes('--release');
const androidDir = path.join(__dirname, '../android');
const signed = fs.existsSync(path.join(androidDir, 'keystore.properties'));
if (release && !signed) console.warn('No android/keystore.properties: the release APK will be UNSIGNED (see README "Release signing").');
const r = spawnSync(win ? 'gradlew.bat' : './gradlew', [release ? 'assembleRelease' : 'assembleDebug'], { cwd: androidDir, stdio: 'inherit', shell: true });
if (r.status === 0) {
  const out = release ? `release/app-release${signed ? '' : '-unsigned'}.apk` : 'debug/app-debug.apk';
  console.log('\nAPK: android/app/build/outputs/apk/' + out);
  const apk = path.join(androidDir, 'app/build/outputs/apk', out);
  if (fs.existsSync(apk)) spawnSync(process.execPath, [path.join(__dirname, 'check-apk.js'), apk], { stdio: 'inherit' });
}
process.exit(r.status);
