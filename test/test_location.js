// Location permission flow (src/location.js) with a fake navigator, storage and a
// minimal fake DOM. Node only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'location.js'), 'utf8');

// Minimal DOM: enough for the rationale dialog (createElement / append / remove / querySelector).
function fakeDom() {
  const body = { children: [], appendChild(n) { n.parent = body; body.children.push(n); return n; } };
  const el = (tag) => ({
    tag, children: [], attrs: {}, className: '', textContent: '', onclick: null,
    setAttribute(k, v) { this.attrs[k] = v; }, append(...ns) { this.children.push(...ns); },
    remove() { body.children = body.children.filter((c) => c !== this); }, focus() { this.focused = true; }
  });
  const listeners = {};
  return {
    body,
    createElement: el,
    querySelector: () => null, // no first-run tips overlay open
    addEventListener: (t, f) => { listeners[t] = f; },
    removeEventListener: (t) => { delete listeners[t]; },
    dialog: () => body.children.find((c) => c.className.includes('loc-rationale')),
    buttons: () => { const d = body.children.find((c) => c.className.includes('loc-rationale')); return d ? d.children[0].children.filter((c) => c.tag === 'button') : []; }
  };
}

function setup({ permission = 'prompt', geo = 'ok', stored = null, noPermissionsApi = false } = {}) {
  const store = new Map(stored ? [['qflowLocRationale', stored]] : []);
  const calls = { geo: 0, ip: 0 };
  const document = fakeDom();
  const ctx = {
    console, setTimeout, clearTimeout, Promise, document,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    navigator: {
      permissions: noPermissionsApi ? undefined : { query: async () => ({ state: permission }) },
      geolocation: {
        getCurrentPosition(ok, err) {
          calls.geo++;
          if (geo === 'ok') ok({ coords: { latitude: 17.36, longitude: 78.47 } });
          else err({ code: geo === 'denied' ? 1 : 3 }); // 1 PERMISSION_DENIED, 3 TIMEOUT
        }
      }
    },
    QFLOW_CONFIG: { ipLookupUrl: 'ip', cacheTtlMs: { ipLookup: 1 } },
    qflowNet: { getJSON: async () => { calls.ip++; return { latitude: 17.4, longitude: 78.5, city: 'Hyderabad', region: 'TG' }; } },
    qflowReverseGeocode: (loc, cb) => cb('Charminar')
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const get = (opts) => new Promise((resolve) => ctx.qflowGetLocation((loc, info) => resolve({ loc, info }), opts));
  return { ctx, store, calls, document, get };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  console.log('--- Location permission flow ---');

  // Pure decision table.
  const D = setup().ctx.qflowLocationDecision;
  assert.strictEqual(D('granted', null, false), 'locate');
  assert.strictEqual(D('granted', 'declined', false), 'locate', 'granted in system settings wins');
  assert.strictEqual(D('denied', 'accepted', true), 'manual-denied', 'never re-prompt after a system denial');
  assert.strictEqual(D('prompt', null, false), 'ask');
  assert.strictEqual(D('unknown', null, false), 'ask', 'no Permissions API: still explain first');
  assert.strictEqual(D('prompt', 'accepted', false), 'locate');
  assert.strictEqual(D('prompt', 'declined', false), 'manual-declined', 'no nagging after "Not now"');
  assert.strictEqual(D('prompt', 'declined', true), 'ask', 'locate button asks again');

  // 1. First use: rationale first, then the system prompt; "Continue" locates.
  {
    const t = setup();
    const p = t.get();
    await tick(); await tick();
    const dlg = t.document.dialog();
    assert.ok(dlg, 'rationale shown before first use');
    assert.strictEqual(t.calls.geo, 0, 'no system prompt before the rationale is answered');
    assert.strictEqual(dlg.attrs.role, 'dialog');
    assert.ok(/starting point/.test(dlg.children[0].children[2].textContent), 'rationale explains why');
    const [yes] = t.document.buttons();
    assert.ok(yes.focused, 'Continue is focused');
    yes.onclick();
    const { loc } = await p;
    assert.strictEqual(loc.label, 'Charminar');
    assert.strictEqual(t.calls.geo, 1);
    assert.strictEqual(t.store.get('qflowLocRationale'), 'accepted');
    assert.ok(!t.document.dialog(), 'dialog removed');
  }

  // 2. "Not now": manual search, no GPS, no IP lookup; remembered.
  {
    const t = setup();
    const p = t.get();
    await tick(); await tick();
    t.document.buttons()[1].onclick();
    const { loc, info } = await p;
    assert.strictEqual(loc, null);
    assert.strictEqual(info.reason, 'declined');
    assert.deepStrictEqual(t.calls, { geo: 0, ip: 0 }, 'declining does not locate by GPS or IP');
    const again = await t.get();
    assert.strictEqual(again.info.reason, 'declined', 'automatic calls do not ask again');
    assert.ok(!t.document.dialog());
  }

  // 3. System prompt denied (after Continue): manual search, never IP lookup.
  {
    const t = setup({ geo: 'denied', stored: 'accepted' });
    const { loc, info } = await t.get();
    assert.strictEqual(loc, null);
    assert.strictEqual(info.reason, 'denied');
    assert.strictEqual(t.calls.ip, 0, 'no IP fallback after a denial');
  }

  // 4. Already denied in settings: no rationale, no prompt.
  {
    const t = setup({ permission: 'denied' });
    const { info } = await t.get({ userInitiated: true });
    assert.strictEqual(info.reason, 'denied');
    assert.strictEqual(t.calls.geo, 0);
    assert.ok(!t.document.dialog());
  }

  // 5. Already granted: straight to GPS, no rationale.
  {
    const t = setup({ permission: 'granted' });
    const { loc } = await t.get();
    assert.ok(loc && !t.document.dialog());
  }

  // 6. GPS timeout (not a permission problem): previous IP fallback still applies.
  {
    const t = setup({ permission: 'granted', geo: 'timeout' });
    const { loc } = await t.get();
    assert.strictEqual(t.calls.ip, 1);
    assert.strictEqual(loc.label, 'Hyderabad, TG');
  }

  // 7. No Permissions API (some Android WebViews): rationale still shown first.
  {
    const t = setup({ noPermissionsApi: true });
    const p = t.get();
    await tick(); await tick();
    assert.ok(t.document.dialog());
    t.document.buttons()[0].onclick();
    assert.ok((await p).loc);
  }

  // 8. Precise refinement: a coarse fix first, then GPS; keeps the best and stops at <= 50 m.
  {
    const timers = [];
    const t = setup({ permission: 'granted' });
    let cleared = false, opts = null, emit = null;
    t.ctx.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
    t.ctx.clearTimeout = () => {};
    t.ctx.navigator.geolocation.watchPosition = (ok, err, o) => { opts = o; emit = ok; return 7; };
    t.ctx.navigator.geolocation.clearWatch = (id) => { cleared = id === 7; };
    const p = t.get();
    await tick(); await tick();
    assert.ok(opts && opts.enableHighAccuracy === true && opts.maximumAge === 0, 'asks for a fresh GPS fix');
    emit({ coords: { latitude: 17.30, longitude: 78.40, accuracy: 1800 } });
    emit({ coords: { latitude: 17.36, longitude: 78.47, accuracy: 32 } });
    const { loc } = await p;
    assert.strictEqual(loc.accuracyM, 32, 'most accurate fix kept');
    assert.ok(cleared, 'watch stopped');
    assert.strictEqual(t.calls.ip, 0);
  }

  // 9. Settle: only a 300 m fix arrives; it is used when the settle timer fires (no IP lookup).
  {
    const timers = [];
    const t = setup({ permission: 'granted' });
    t.ctx.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
    t.ctx.clearTimeout = () => {};
    let emit = null;
    t.ctx.navigator.geolocation.watchPosition = (ok) => { emit = ok; return 1; };
    t.ctx.navigator.geolocation.clearWatch = () => {};
    const p = t.get();
    await tick(); await tick();
    emit({ coords: { latitude: 17.36, longitude: 78.47, accuracy: 300 } });
    const settle = timers.find((x) => x.ms === 6000);
    assert.ok(settle, 'settle timer started after the first fix');
    settle.f();
    const { loc } = await p;
    assert.strictEqual(loc.accuracyM, 300);
    assert.strictEqual(t.calls.ip, 0);
  }

  // 10. Location services off (POSITION_UNAVAILABLE) and IP lookup fails: reason + advice.
  {
    const t = setup({ permission: 'granted', geo: 'denied' });
    t.ctx.navigator.geolocation.getCurrentPosition = (ok, err) => { t.calls.geo++; err({ code: 2 }); };
    t.ctx.qflowNet.getJSON = async () => { t.calls.ip++; throw new Error('offline'); };
    const { loc, info } = await t.get();
    assert.strictEqual(loc, null);
    assert.strictEqual(info.reason, 'unavailable');
    assert.strictEqual(info.why, 'off');
    assert.strictEqual(t.calls.geo, 2, 'precise attempt, then a quick network fix');
    assert.ok(/Turn on Location/.test(t.ctx.qflowLocationHelpText(info)));
  }

  // 11. Android app: the WebView's Permissions API is ignored (it can say "denied" while
  //     Android would allow it); Android's own answer decides. A real denial is remembered.
  {
    const t = setup({ permission: 'denied', stored: 'accepted' });
    t.ctx.window = { Capacitor: { isNativePlatform: () => true } };
    const { loc } = await t.get({ userInitiated: true });
    assert.ok(loc, 'located even though the WebView reported denied');
    const t2 = setup({ permission: 'denied', stored: 'accepted', geo: 'denied' });
    t2.ctx.window = { Capacitor: { isNativePlatform: () => true } };
    const r2 = await t2.get();
    assert.strictEqual(r2.info.reason, 'denied');
    assert.strictEqual(t2.store.get('qflowLocRationale'), 'declined', 'automatic starts will not re-prompt');
    assert.strictEqual(t2.calls.ip, 0);
  }

  // 12. Accuracy hint for coarse ("Approximate") fixes.
  {
    const { ctx } = setup();
    assert.ok(/Precise/.test(ctx.qflowLocationAccuracyHint({ source: 'device', accuracyM: 2500 })));
    assert.strictEqual(ctx.qflowLocationAccuracyHint({ source: 'device', accuracyM: 40 }), '');
  }

  console.log('✓ GPS fix refined to the most accurate reading (stops at 50 m); network fix before IP; location-off advice; Android permission decided by Android.');
  console.log('✓ rationale before first use; "Not now" and denials fall back to manual search (no IP lookup); granted / timeout paths unchanged.');
})().catch((e) => { console.error(e); process.exit(1); });
