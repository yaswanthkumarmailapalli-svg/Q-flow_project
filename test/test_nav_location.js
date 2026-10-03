// LocationService (src/nav-location.js) with a fake geolocation (TEST-ONLY): permission
// states, GPS off, weak/approximate fixes, signal loss watchdog, background/foreground.
const assert = require('assert');
const path = require('path');
const NL = require(path.join(__dirname, '..', 'src', 'nav-location.js'));
console.log('--- LocationService (fake geolocation) ---');

function env(o) {
  let t = 0, ok = null, err = null, watches = 0, clears = 0;
  const timers = [], docL = {};
  const geo = { watchPosition(a, b, opt) { ok = a; err = b; watches++; env.lastOpt = opt; return watches; }, clearWatch() { clears++; } };
  const doc = { visibilityState: 'visible', addEventListener: (k, f) => { docL[k] = f; }, removeEventListener: (k) => { delete docL[k]; } };
  const svc = NL.createLocationService(Object.assign({ geolocation: geo, document: doc, now: () => t, setTimeout: (f, ms) => { timers.push({ f, at: t + ms }); return timers.length; }, clearTimeout() {}, window: { isSecureContext: true, addEventListener() {}, removeEventListener() {} } }, o || {}));
  const fixes = [], st = [];
  return { svc, fixes, st, start() { svc.start((f) => fixes.push(f), (s) => st.push(s.code)); }, advance(ms) { t += ms; timers.splice(0).forEach((x) => { if (x.at <= t) x.f(); else timers.push(x); }); },
    pos(c) { ok({ coords: Object.assign({ latitude: 17.38, longitude: 78.48, accuracy: 8, heading: 45, speed: 10, altitude: 500 }, c), timestamp: t }); }, err: (c) => err({ code: c }), get watches() { return watches; }, get clears() { return clears; }, doc, docL, set t(v) { t = v; } };
}

{ const e = env(); e.start();
  assert.ok(env.lastOpt.enableHighAccuracy === true && env.lastOpt.maximumAge <= 1000, 'high-accuracy continuous watch');
  e.pos(); assert.strictEqual(e.fixes[0].heading, 45); assert.deepStrictEqual(e.st, ['searching', 'ok']);
  e.pos({ speed: 0, heading: 200 }); assert.strictEqual(e.fixes[1].heading, null, 'heading ignored when not moving');
  e.pos({ accuracy: 120 }); assert.strictEqual(e.st[e.st.length - 1], 'weak');
  e.pos({ accuracy: 2000 }); assert.strictEqual(e.st[e.st.length - 1], 'weak');
  e.pos({ accuracy: 9 }); assert.strictEqual(e.st[e.st.length - 1], 'ok'); }
{ const e = env(); e.start(); e.err(1); assert.strictEqual(e.st.pop(), 'denied-permanent', 'instant denial = blocked in settings'); assert.ok(e.clears >= 1); }
{ const e = env(); e.start(); e.advance(3000); e.err(1); assert.strictEqual(e.st.pop(), 'denied', 'denied at the prompt'); }
{ const e = env(); e.start(); e.err(2); assert.strictEqual(e.st.pop(), 'off', 'location services off'); }
{ const e = env(); e.start(); e.pos(); e.err(3); assert.strictEqual(e.st.pop(), 'lost', 'timeout after fixes = signal lost; keeps watching'); }
{ const e = env(); e.start(); e.pos(); const w = e.watches; for (let i = 0; i < 4; i++) e.advance(5000);
  assert.strictEqual(e.st[e.st.length - 1], 'lost'); assert.ok(e.watches > w, 'watchdog restarts the watch when updates stop');
  const w2 = e.watches; for (let i = 0; i < 6; i++) e.advance(5000);
  assert.ok(e.watches - w2 <= 2, 'during a long outage the watch restarts about every 15 s, not every 5 s (' + (e.watches - w2) + ' in 30 s)'); }
{ const e = env(); e.start(); e.pos(); e.doc.visibilityState = 'hidden'; e.docL.visibilitychange();
  assert.strictEqual(e.st[e.st.length - 1], 'paused'); const w = e.watches;
  e.doc.visibilityState = 'visible'; e.docL.visibilitychange(); assert.ok(e.watches === w + 1 && e.st[e.st.length - 1] === 'searching', 'resumes on return to the foreground');
  e.svc.stop(); assert.ok(!e.docL.visibilitychange, 'stop removes listeners'); }
{ const e = env({ geolocation: null }); e.start(); assert.deepStrictEqual(e.st, ['unsupported']); }
{ const e = env({ window: { isSecureContext: false } }); e.start(); assert.deepStrictEqual(e.st, ['insecure']); }
console.log('✓ continuous high-accuracy watch; heading only when moving; weak / approximate accuracy; denied vs blocked; GPS off; signal lost + watchdog restart; background pause and resume; unsupported and insecure pages.');
