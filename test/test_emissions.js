// CO2 model checks (node only). Properties, not exact numbers.
const assert = require('assert');
const E = require('../src/emissions.js');
const V = require('../src/vrp-engine.js');
const X = require('../src/vrp-extras.js');

console.log('--- Emissions model ---');
const g = (v, o) => E.gPerKm(v, o);

// U-shape: high in slow traffic, lowest at moderate speed, rising at motorway speed.
assert.ok(g(10) > g(20) && g(20) > g(30) && g(30) > g(45), 'falls as speed rises from stop-and-go');
assert.ok(g(120) > g(80) && g(130) > g(110), 'rises again at high speed');
let vMin = 10;
for (let v = 10; v <= 130; v++) if (g(v) < g(vMin)) vMin = v;
assert.ok(vMin >= 50 && vMin <= 80, `minimum at ${vMin} km/h should be in the 50-80 km/h band`);
assert.ok(g(10) > 2 * g(vMin), 'slow traffic is much worse than free flow');
assert.ok(Math.abs(g(60) - 120) < 5, 'reference car is ~120 g/km near 60 km/h (old constant)');

// Clamped to the curve's valid range.
assert.strictEqual(g(2), g(10));
assert.strictEqual(g(250), g(130));

// Fallback to the flat factor when speed is unavailable.
for (const bad of [undefined, null, NaN, 0, -5, Infinity, '50']) {
  assert.strictEqual(g(bad), 120, `fallback for speed=${String(bad)}`);
  assert.strictEqual(g(bad, { baseGPerKm: 140 }), 140);
}
assert.strictEqual(E.MODEL.referenceGPerKm, 120);

// Vehicle scaling and flat (EV) mode.
assert.ok(Math.abs(g(35, { baseGPerKm: 42 }) - g(35) * 42 / 120) < 1e-9, 'other vehicles scale the curve');
assert.strictEqual(g(15, { baseGPerKm: 28, speedCurve: false }), 28);
assert.strictEqual(g(90, { baseGPerKm: 28, speedCurve: false }), 28);

// Trip helper.
assert.strictEqual(E.tripGrams(0, 10), 0);
assert.strictEqual(E.tripGrams(10, 0), 1200, 'no driving time -> flat 120 g/km');
assert.ok(Math.abs(E.tripGrams(10, 10) - 10 * g(60)) < 1e-9, '10 km in 10 min = 60 km/h');
console.log(`✓ U-shaped curve (minimum ${Math.round(g(vMin))} g/km at ${vMin} km/h, ${Math.round(g(10))} g/km at 10 km/h), clamped, scaled per vehicle, flat for EVs, 120 g/km fallback.`);

console.log('\n--- Engine integration ---');
const nodes = V.generateBenchmarkInstance(12, undefined, { seed: 7 });
const seq = Array.from({ length: 12 }, (_, i) => i + 1);
const free = V.buildCostMatrix(nodes, 0.4), jam = V.buildCostMatrix(nodes, 1.9);
const evFree = V.evaluateTourSequence(seq, nodes, free, 80, 3);
const evJam = V.evaluateTourSequence(seq, nodes, jam, 80, 3);
for (const ev of [evFree, evJam]) {
  const sumDist = ev.routes.reduce((s, r) => s + r.distKm, 0);
  assert.ok(Math.abs(sumDist - ev.totalDist) < 0.011, 'per-route distances add up to the total');
  for (const r of ev.routes) assert.ok(r.driveTimeMin > 0 && r.driveTimeMin <= r.finishTime + 1e-9, 'driving time is part of the route time');
  assert.strictEqual(V.co2GramsOf(ev), Math.round(E.routesGrams(ev.routes)), 'engine CO2 = per-route speed model');
}
assert.strictEqual(evFree.totalDist, evJam.totalDist, 'congestion changes time, not distance');
assert.ok(V.co2GramsOf(evJam) > V.co2GramsOf(evFree), 'same tour in heavy traffic (slower) emits more CO2');
assert.strictEqual(V.co2GramsOf({ routes: [], totalDist: 10 }), 1200, 'fallback: flat 120 g/km when route data is missing');

const m = V.buildCostMatrix(nodes, 1.2);
for (const r of [V.runQPSO(nodes, m, 80, 3, { seed: 1, maxEvaluations: 600 }), X.runPSO(nodes, m, 80, 3, { seed: 1, maxEvaluations: 600 }), V.runClarkeWright(nodes, m, 80, 3)]) {
  assert.ok(Number.isInteger(r.co2Grams) && r.co2Grams > 0, `${r.algorithm}: co2Grams`);
  assert.strictEqual(r.co2Grams, Math.round(E.routesGrams(r.routes)), `${r.algorithm}: uses the speed model`);
  const avgSpeed = r.totalDistKm / (r.routes.reduce((s, x) => s + x.driveTimeMin, 0) / 60);
  assert.ok(r.co2Grams / r.totalDistKm >= g(vMin) - 1e-9, `${r.algorithm}: g/km is never below the curve minimum (avg ${avgSpeed.toFixed(0)} km/h)`);
}
console.log(`✓ Engine CO2 uses each route's driving speed; heavy traffic raises it (${V.co2GramsOf(evFree)} g -> ${V.co2GramsOf(evJam)} g for the same tour); solvers report it.`);
