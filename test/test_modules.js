// Checks the split of the former app.js into src/ modules (node only).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
// Required load order. Top-level declarations are shared globals across these
// plain scripts, so each file may only use earlier files at load time.
const ORDER = ['safe-html.js', 'net.js', 'emissions.js', 'config.js', 'ui.js', 'i18n.js', 'location.js', 'geocode.js', 'routing.js', 'traffic-live.js', 'swarm-sim.js', 'map.js', 'trips.js'];

console.log('--- App modules ---');
for (const f of ORDER) assert.ok(fs.existsSync(path.join(SRC, f)), `missing src/${f}`);
assert.ok(!fs.existsSync(path.join(SRC, 'app.js')), 'app.js was split and should no longer exist');

const pages = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
assert.ok(pages.length >= 8, 'expected the app pages in src/');
for (const page of pages) {
  const html = fs.readFileSync(path.join(SRC, page), 'utf8');
  assert.ok(!/src="app\.js"/.test(html), `${page} still loads app.js`);
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const loaded = srcs.filter((s) => ORDER.includes(s));
  assert.deepStrictEqual(loaded, ORDER, `${page}: app modules missing or out of order`);
  // Page-specific scripts (mode.js, insights.js, vrp-*.js) come after the app modules.
  const lastModule = srcs.indexOf('trips.js');
  for (const s of ['mode.js', 'insights.js', 'vrp-engine.js', 'vrp-extras.js']) {
    if (srcs.includes(s)) assert.ok(srcs.indexOf(s) > lastModule, `${page}: ${s} must load after the app modules`);
  }
  // Every local script referenced by the page exists.
  for (const s of srcs.filter((x) => !/^https?:/.test(x))) assert.ok(fs.existsSync(path.join(SRC, s)), `${page}: missing ${s}`);
}

// Each global used across files is defined exactly once.
const all = ORDER.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
for (const name of ['QFLOW_CONFIG', 'qflowNet', 'qflowStatus', 'qflowAudio', 'qflowToast', 'qflowInitChrome', 'qflowLang', 'qflowSetLang',
  'qflowGetLocation', 'qflowReverseGeocode', 'qflowAttachAutocomplete', 'qflowRoutes', 'qflowScoreRoutes', 'VEHICLE_PROFILES',
  'QFLOW_ROUTE_COLORS', 'qflowBuildMap', 'qflowAddHistory', 'qflowGetHistory', 'qflowLeaveBy', 'qflowExportGPX', 'qflowExportGeoJSON']) {
  const defs = all.match(new RegExp(`^(?:const|let|function|class)\\s+${name}\\b`, 'gm')) || [];
  assert.strictEqual(defs.length, 1, `${name} should be defined once at top level (found ${defs.length})`);
}

// swarm-sim.js is UMD: usable from Node.
const S = require(path.join(SRC, 'swarm-sim.js'));
const swarm = S.qflowCreateSwarm(12);
assert.strictEqual(swarm.particles.length, 12);
let r;
for (let i = 0; i < 40; i++) r = S.qflowSwarmStep(swarm);
assert.strictEqual(r.iter, 40);
assert.ok(r.convergencePct >= 0 && r.convergencePct <= 100);
assert.ok(swarm.history.length <= 30 && swarm.globalBestCost <= swarm.history[0] + 1e-12, 'best cost never increases');
console.log(`✓ ${ORDER.length} modules present, loaded in order on ${pages.length} pages; shared globals defined once; swarm-sim works under Node.`);
