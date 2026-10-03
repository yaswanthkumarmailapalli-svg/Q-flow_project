// Runs the real Results page script (src/results.html) with the navigation modules in a
// tiny fake DOM + Leaflet stand-in, presses "Start", and feeds GPS readings through a fake
// navigator.geolocation. TEST-ONLY: the fake GPS and fake fetch exist only in this file.
console.log('--- Navigation screen (results.html, fake DOM, test-only GPS feed) ---');
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const SRC = path.join(__dirname, '..', 'src');

// ---------- fake DOM ----------
function El(tag, id) {
  this.tagName = (tag || 'div').toUpperCase(); this.id = id || ''; this.children = []; this.attrs = {}; this.style = {}; this.dataset = {};
  this._html = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.listeners = {};
  const cls = new Set();
  this.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : f; on ? cls.add(c) : cls.delete(c); return on; }, contains: (c) => cls.has(c) };
  Object.defineProperty(this, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); } });
}
El.prototype = {
  get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this.children = []; },
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, append(...c) { c.forEach((x) => this.appendChild(x)); }, prepend(c) { this.children.unshift(c); },
  insertBefore(c) { this.children.push(c); return c; }, remove() {}, replaceChildren(...c) { this.children = c; },
  insertAdjacentHTML(p, h) { this._html += h; },
  setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {}, dispatchEvent() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700 }; }, focus() {}, scrollIntoView() {},
  setPointerCapture() {}, getContext() { return new Proxy({}, { get: () => () => ({ width: 10 }) }); },
  get clientWidth() { return 400; }, get clientHeight() { return 700; }, get parentElement() { return new El('div'); }, get firstChild() { return this.children[0] || new El('span'); }
};
const byId = {};
const getEl = (id) => byId[id] || (byId[id] = new El('div', id));
const html = fs.readFileSync(path.join(SRC, 'results.html'), 'utf8');
for (const m of html.matchAll(/<(\w+)\b([^>]*)>/g)) { const id = (m[2].match(/\bid="([^"]+)"/) || [])[1]; if (!id) continue; const e = getEl(id); e.tagName = m[1].toUpperCase(); if (/\bhidden\b/.test(m[2])) e.hidden = true; }

// ---------- Leaflet stand-in (enough for the page and the camera) ----------
const layers = [];
const mkLayer = (kind, a) => {
  const el = new El('div'); const arrow = new El('div'); arrow.className = 'qf-nav-arrow'; el.querySelector = (s) => (s === '.qf-nav-arrow' ? arrow : null);
  const l = { kind, a, latlngs: Array.isArray(a) ? a : null, addTo(m) { layers.push(this); return this; }, bindPopup() { return this; }, openPopup() { return this; }, on() { return this; },
    setStyle() { return this; }, bringToFront() { return this; }, setLatLngs(v) { this.latlngs = v; return this; }, setLatLng(v) { this.ll = v; return this; }, setRadius(r) { this.r = r; return this; },
    getBounds() { return {}; }, getElement() { return el; }, _arrow: arrow };
  return l;
};
function mkMap() {
  let center = { lat: 0, lng: 0 }, zoom = 5;
  const k = (z) => 256 * Math.pow(2, z) / 360;
  const m = {
    setView(c, z) { center = Array.isArray(c) ? { lat: c[0], lng: c[1] } : { lat: c.lat, lng: c.lng }; if (z !== undefined) zoom = z; return m; },
    getCenter() { return center; }, getZoom() { return zoom; }, setZoom(z) { zoom = z; return m; },
    project(ll, z) { return { x: ll.lng * k(z), y: -ll.lat * k(z) }; }, unproject(p, z) { return { lat: -p.y / k(z), lng: p.x / k(z) }; },
    panBy(p) { center = { lat: center.lat + p.y / k(zoom) * -1, lng: center.lng + p.x / k(zoom) }; return m; },
    on() { return m; }, addLayer() { return m; }, removeLayer() { return m; }, hasLayer() { return true; }, fitBounds() { return m; }, invalidateSize() { return m; }, flyTo() { return m; },
    eachLayer() {}, createPane() { return new El('div'); }, getContainer() { return new El('div'); }, getSize() { return { x: 400, y: 700 }; }
  };
  return m;
}
const maps = [];
const L = {
  map() { const m = mkMap(); maps.push(m); return m; }, tileLayer() { return { addTo() { return this; }, on() { return this; } }; },
  control: Object.assign(() => ({ addTo() { return this; } }), { zoom: () => ({ addTo() { return this; } }) }),
  polyline: (a) => mkLayer('polyline', a), marker: (a) => mkLayer('marker', a), circleMarker: (a) => mkLayer('circleMarker', a), circle: (a) => mkLayer('circle', a),
  divIcon: (o) => o, latLng: (a, b) => ({ lat: a, lng: b }), point: (x, y) => (typeof x === 'object' ? x : { x, y }), layerGroup: () => mkLayer('group'),
  DomUtil: { create: (t, c) => { const e = new El(t); e.className = c || ''; return e; } }, DomEvent: { disableClickPropagation() {} }
};

// ---------- route fixture: 1.2 km east, left, 0.8 km north (OSRM format) ----------
const O = [17.3850, 78.4867], mLat = 110540, mLng = 111320 * Math.cos(17.39 * Math.PI / 180);
const at = (e, n) => [O[0] + n / mLat, O[1] + e / mLng];
const geo = []; for (let e = 0; e <= 1200; e += 50) geo.push(at(e, 0)); for (let n = 50; n <= 800; n += 50) geo.push(at(1200, n));
const ll = (p) => [p[1], p[0]];
const routeJson = (fromLat, fromLng) => {
  const start = fromLat === undefined ? O : [fromLat, fromLng];
  const coords = fromLat === undefined ? geo : [start, at(1200, 300), at(1200, 800)];
  return { code: 'Ok', routes: [{ distance: 2000, duration: 240, geometry: { type: 'LineString', coordinates: coords.map(ll) },
    legs: [{ steps: fromLat === undefined ? [
      { name: 'Station Road', distance: 1200, duration: 140, maneuver: { type: 'depart', bearing_after: 90, location: ll(at(0, 0)) } },
      { name: 'Lake View Road', distance: 800, duration: 100, maneuver: { type: 'turn', modifier: 'left', location: ll(at(1200, 0)) } },
      { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', location: ll(at(1200, 800)) } }] : [
      { name: 'Link Road', distance: 900, duration: 120, maneuver: { type: 'depart', bearing_after: 30, location: ll(start) } },
      { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', location: ll(at(1200, 800)) } }] }] }] };
};
const fetches = [];
const fetchMock = (url) => {
  fetches.push(url);
  let body;
  if (/\/route\/v1\//.test(url)) {
    const first = url.split('/route/v1/driving/')[1].split(';')[0].split(',').map(Number);
    const fromStart = Math.abs(first[1] - O[0]) < 1e-5 && Math.abs(first[0] - O[1]) < 1e-5;
    body = fromStart ? routeJson() : routeJson(first[1], first[0]);
  } else body = { elements: [] };
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
};

// ---------- fake GPS (test-only) ----------
let watchCb = null, watchErr = null, cleared = 0;
const geolocation = { watchPosition(ok, err) { watchCb = ok; watchErr = err; return 1; }, clearWatch() { cleared++; }, getCurrentPosition(ok) { ok({ coords: { latitude: O[0], longitude: O[1], accuracy: 10 }, timestamp: Date.now() }); } };
let gpsT = 1e6;
const gps = (e, n, o) => { const p = at(e, n); gpsT += (o && o.dt) || 1000; watchCb({ coords: Object.assign({ latitude: p[0], longitude: p[1], accuracy: 8, heading: 90, speed: 12, altitude: null }, o && o.coords), timestamp: gpsT }); };

const store = new Map(Object.entries({ qflowFrom: 'My location', qflowTo: 'Lake View', qflowFromLat: String(O[0]), qflowFromLng: String(O[1]),
  qflowToLat: String(at(1200, 800)[0]), qflowToLng: String(at(1200, 800)[1]), qflowStops: '[]', qflowLocRationale: 'accepted', qflowNavVoice: 'off' }));
const timers = [], toasts = [];
const document = { documentElement: new El('html'), body: new El('body'), visibilityState: 'visible', getElementById: getEl, createElement: (t) => new El(t),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
const ctx = { console, Math, JSON, Date, Object, Array, Number, String, Promise, Map, Set, Proxy, Symbol, Error, TypeError, Float64Array, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  document, L, performance: { now: (() => { let t = 0; return () => (t += 16); })() }, navigator: { onLine: true, geolocation, language: 'en-IN' },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] || null, get length() { return store.size; } },
  setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, setInterval() {}, requestAnimationFrame: (f) => { timers.push({ f: () => f(Date.now()), ms: 16 }); },
  matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '#888888', position: 'static' }),
  CustomEvent: function (t) { this.type = t; }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, confirm: () => true, devicePixelRatio: 1, innerWidth: 400, innerHeight: 700,
  isSecureContext: true, screen: {}, fetch: fetchMock, AbortController, URL, Blob: function () {}, crypto: globalThis.crypto, location: { protocol: 'https:', hostname: 'localhost', href: '' } };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
const mods = ['safe-html.js', 'net.js', 'emissions.js', 'local-config.js', 'config.js', 'ui.js', 'i18n.js', 'location.js', 'geocode.js', 'routing.js', 'traffic-live.js', 'swarm-sim.js', 'map.js', 'trips.js', 'insights.js',
  'nav-routing.js', 'nav-progress.js', 'nav-location.js', 'nav-camera.js', 'nav-device.js', 'nav-controller.js'];
for (const f of mods) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
vm.runInContext('qflowToast=(m,k)=>__toasts.push(k+": "+m)', Object.assign(ctx, { __toasts: toasts }));
const inline = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.slice(8, -9)).filter((s) => !/Theme before first paint/.test(s)).join('\n;\n');
vm.runInContext(inline + '\n;globalThis.__nav={get ctl(){return navCtl},get camera(){return navCamera},get sel(){return selectedRoute},get user(){return navUserMarker}};', ctx, { filename: 'results-inline.js' });
const flush = (n = 400) => { let i = 0; while (timers.length && i < n) { timers.shift().f(); i++; } };
const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise((r) => setImmediate(r)); flush(60); } };
const passed = [];
const ok = (c, m) => { assert.ok(c, m); passed.push(m); };

(async () => {
  await settle();
  ok(ctx.__nav.sel && ctx.__nav.sel.steps.length && ctx.__nav.sel.steps[1].maneuver && ctx.__nav.sel.steps[1].maneuver.modifier === 'left', 'route preview keeps OSRM maneuver data');
  ok(!/runSimTick|simSpeedMultiplier|Simulated destination/.test(html), 'simulator code removed from the page');

  getEl('startNavBtn').onclick();
  await settle();
  ok(getEl('navSimModal').classList.contains('active'), 'navigation screen opened');
  ok(watchCb && /Getting your location/.test(getEl('simMainInstruction').textContent), 'waits for the real GPS position (no fixed start point)');
  const nRoutes = fetches.filter((u) => /\/route\/v1\//.test(u)).length;

  gps(20, 2);
  await settle();
  ok(ctx.__nav.ctl.phase === 'navigating', 'navigating after the first GPS fix');
  ok(fetches.filter((u) => /\/route\/v1\//.test(u)).length === nRoutes, 'on the previewed route: no new route request');
  ok(/Turn left onto Lake View Road/.test(getEl('simMainInstruction').textContent), 'next maneuver shown: ' + getEl('simMainInstruction').textContent);
  ok(/^In 1\.2 km$|^In 1150 m$|^In 1200 m$/.test(getEl('simSubInstruction').textContent) || /In \d/.test(getEl('simSubInstruction').textContent), 'distance to the maneuver shown');
  ok(/km|m/.test(getEl('simRemainingDist').textContent) && /min/.test(getEl('simEta').textContent) && /Arrive at/.test(getEl('navArrive').textContent), 'remaining distance, time and arrival clock shown');
  ok(getEl('simSpeed').textContent === '43 km/h', 'speed from GPS: ' + getEl('simSpeed').textContent);
  ok(/GPS ±8 m/.test(getEl('navGpsBadge').textContent), 'GPS accuracy shown');
  ok(ctx.__nav.user && ctx.__nav.user.ll && Math.abs(ctx.__nav.user.ll[0] - at(20, 2)[0]) < 1e-9, 'user marker at the real GPS position');

  for (let e = 40; e <= 600; e += 12) gps(e, 0);
  await settle();
  ok(/Station Road/.test(getEl('navRoad').textContent), 'current road shown');
  ok(ctx.__nav.camera.mode === 'follow' && Math.abs(QFlowNavProgress_angle(ctx.__nav.camera.rotation, 90)) < 15, 'camera follows and turns to the direction of travel (east): ' + ctx.__nav.camera.rotation.toFixed(1));

  // A user gesture switches to free mode; the re-centre button returns to follow mode.
  const vp = getEl('navViewport');
  vp.listeners.pointerdown[0]({ pointerId: 1, clientX: 100, clientY: 100, target: new El('div') });
  vp.listeners.pointermove[0]({ pointerId: 1, clientX: 160, clientY: 120 });
  vp.listeners.pointerup[0]({ pointerId: 1 });
  ok(ctx.__nav.camera.mode === 'free' && getEl('navRecenterBtn').hidden === false, 'panning switches to free map mode and shows Re-centre');
  getEl('navRecenterBtn').onclick();
  ok(ctx.__nav.camera.mode === 'follow' && getEl('navRecenterBtn').hidden === true, 'Re-centre restores follow mode');

  // Leave the route: one reroute from the CURRENT position.
  for (let k = 1; k <= 8; k++) gps(600 + k * 10, k * 15, { coords: { heading: 30 } });
  await settle();
  const routeUrls = fetches.filter((u) => /\/route\/v1\//.test(u));
  const last = routeUrls[routeUrls.length - 1];
  const fromLng = Number(last.split('/route/v1/driving/')[1].split(',')[0]);
  ok(routeUrls.length === nRoutes + 1, 'exactly one reroute request');
  ok(fromLng > at(600, 0)[1] && /bearings=\d+,60/.test(last), 'reroute from the latest GPS position, with the heading');
  ok(ctx.__nav.ctl.rerouteCount === 1 && /Link Road|arrived/i.test(getEl('simMainInstruction').textContent + ' ' + (ctx.__nav.ctl.route.steps[0].name)), 'new route in use');

  // Drive to the destination along the new route.
  for (let n = 300; n <= 800; n += 25) gps(1200, n, { coords: { heading: 0 } });
  await settle();
  ok(ctx.__nav.ctl.phase === 'arrived' && getEl('navArrived').hidden === false && /You have arrived/.test(getEl('simMainInstruction').textContent), 'arrival detected and shown');
  ok(cleared >= 1, 'GPS updates stopped after arrival');

  // Permission denied path.
  getEl('navEndBtn').onclick();
  getEl('startNavBtn').onclick();
  await settle();
  watchErr({ code: 1 });
  await settle();
  ok(/Location is blocked|permission was denied/.test(getEl('navStatus').textContent) && getEl('navStatus').hidden === false, 'permission denial explained: ' + getEl('navStatus').textContent.slice(0, 60));
  getEl('navEndBtn').onclick();
  ok(!getEl('navSimModal').classList.contains('active'), 'End closes navigation');

  console.log(`✓ ${passed.length} navigation-screen checks: starts from the real GPS fix, preview reused only on-route, maneuver/ETA/speed/road from GPS, heading-up follow camera, free mode + re-centre, one reroute from the latest position, arrival stops GPS, permission denial message, simulator removed.`);
})().catch((e) => { console.error(e); process.exit(1); });

function QFlowNavProgress_angle(a, b) { return ((b - a + 540) % 360) - 180; }
