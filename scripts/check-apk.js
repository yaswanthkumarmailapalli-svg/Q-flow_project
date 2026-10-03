// Checks an APK before you share it:  node scripts/check-apk.js [path/to/app.apk]
// Reads the binary AndroidManifest.xml inside the APK (no Android SDK needed) and reports
// package, versions, minSdk, testOnly and whether the APK carries a signature.
// testOnly="true" (added by Android Studio's Run button) makes other phones refuse the APK
// with "App not installed" / "package appears to be invalid".
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const defaults = [
  'android/app/build/outputs/apk/release/app-release.apk',
  'android/app/build/outputs/apk/debug/app-debug.apk',
  'android/app/build/intermediates/apk/debug/app-debug.apk'
].map(p => path.join(__dirname, '..', p));
const file = process.argv[2] || defaults.find(p => fs.existsSync(p));
if (!file || !fs.existsSync(file)) { console.error('No APK found. Pass a path: node scripts/check-apk.js app.apk'); process.exit(2); }
const zip = fs.readFileSync(file);

// Minimal ZIP reader: find an entry in the central directory and inflate it.
function readEntry(name) {
  let eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP/APK file (the download may be damaged)');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42), entry = zip.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + csize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

// Minimal binary-XML (AXML) reader: collect the attributes we care about.
function manifestAttrs(d) {
  const attrs = {};
  const poolSize = d.readUInt32LE(12), sc = d.readUInt32LE(16), flags = d.readUInt32LE(24), sStart = d.readUInt32LE(28);
  const utf8 = flags & 0x100, strs = [];
  for (let i = 0; i < sc; i++) {
    let q = 8 + sStart + d.readUInt32LE(36 + 4 * i);
    if (utf8) {
      q += (d[q] & 0x80) ? 2 : 1;
      let n = d[q]; q += 1; if (n & 0x80) { n = ((n & 0x7f) << 8) | d[q]; q += 1; }
      strs.push(d.toString('utf8', q, q + n));
    } else {
      let n = d.readUInt16LE(q); q += 2;
      if (n & 0x8000) { n = ((n & 0x7fff) << 16) | d.readUInt16LE(q); q += 2; }
      strs.push(d.toString('utf16le', q, q + 2 * n));
    }
  }
  let p = 8 + poolSize;
  while (p + 8 <= d.length) {
    const type = d.readUInt16LE(p), size = d.readUInt32LE(p + 4);
    if (!size) break;
    if (type === 0x0102) { // start element
      const tag = strs[d.readUInt32LE(p + 20)], n = d.readUInt16LE(p + 28);
      for (let a = 0; a < n; a++) {
        const q = p + 36 + a * 20, name = strs[d.readUInt32LE(q + 4)], raw = d.readUInt32LE(q + 8);
        const dt = d[q + 15], val = d.readUInt32LE(q + 16);
        const v = raw !== 0xffffffff ? strs[raw] : dt === 0x12 ? (val !== 0) : val;
        if (!((tag + '.' + name) in attrs)) attrs[tag + '.' + name] = v;
      }
    }
    p += size;
  }
  return attrs;
}

try {
  const m = readEntry('AndroidManifest.xml');
  if (!m) throw new Error('no AndroidManifest.xml inside (not an APK, or damaged in transfer)');
  const a = manifestAttrs(m);
  const signed = zip.includes(Buffer.from('APK Sig Block 42')) || !!readEntry('META-INF/CERT.RSA');
  const testOnly = a['application.testOnly'] === true;
  console.log('APK:          ' + path.relative(process.cwd(), file));
  console.log('Package:      ' + a['manifest.package']);
  console.log('Version:      ' + a['manifest.versionName'] + ' (code ' + a['manifest.versionCode'] + ')');
  console.log('minSdk:       ' + a['uses-sdk.minSdkVersion'] + '   targetSdk: ' + a['uses-sdk.targetSdkVersion']);
  console.log('Debuggable:   ' + (a['application.debuggable'] === true ? 'yes (debug build)' : 'no'));
  console.log('Signed:       ' + (signed ? 'yes' : 'NO'));
  console.log('testOnly:     ' + (testOnly ? 'YES' : 'no'));
  const problems = [];
  if (testOnly) problems.push('testOnly=true: built with Android Studio\'s Run button. Other phones will say "App not installed". Rebuild with `npm run android:apk` or Build > Build App Bundle(s) / APK(s) > Build APK(s).');
  if (!signed) problems.push('Unsigned: Android will not install it. Use the debug APK, or set up android/keystore.properties for release (README "Release signing").');
  if (problems.length) { console.log('\nNOT OK to share:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('\nOK to share.');
} catch (e) { console.error('Could not read the APK: ' + e.message); process.exit(2); }
