// Regression tests for bugs found in the 2026-10-01 audit (docs/AUDIT.md). Node only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const V = require('../src/vrp-engine.js');
const X = require('../src/vrp-extras.js');
const { assertValidSolution } = require('./test_helpers.js');

const DEPOT = { id: 0, lat: 17.385, lng: 78.4867, demand: 0, readyTime: 0, dueTime: 720, serviceTime: 0 };
const stop = (id, o = {}) => Object.assign({ id, lat: 17.385 + id * 0.004, lng: 78.4867 + id * 0.003, demand: 10, readyTime: 0, dueTime: 600, serviceTime: 5 }, o);
const SOLVERS = { QPSO: V.runQPSO, PSO: X.runPSO, GA: V.runGA, ACO: V.runACO, SA: V.runSA, CW: V.runClarkeWright, Exact: V.runExact };

console.log('--- Empty and tiny instances (F5) ---');
{
  const nodes = [DEPOT], m = V.buildCostMatrix(nodes, 1);
  for (const [k, fn] of Object.entries(SOLVERS)) {
    const r = fn(nodes, m, 80, 2, { seed: 1, maxEvaluations: 50 });
    assert.strictEqual(r.bestCost, 0, `${k}: empty instance costs 0`);
    assert.deepStrictEqual(r.routes, [], `${k}: no routes`);
    assert.strictEqual(r.feasible, true, `${k}: empty plan is feasible`);
  }
  const b = V.runFullBenchmark(nodes, m, 80, 2, { runs: 2, maxEvaluations: 50 });
  assert.ok(b.results.every((r) => Number.isFinite(r.stats.gapPct)), 'gaps are finite numbers with a zero reference');
  assert.doesNotThrow(() => JSON.stringify(b), 'benchmark result is JSON-serialisable');
  const one = [DEPOT, stop(1)], m1 = V.buildCostMatrix(one, 1);
  for (const [k, fn] of Object.entries(SOLVERS)) assertValidSolution(fn(one, m1, 80, 2, { seed: 1, maxEvaluations: 50 }), one, m1, 80, 2);
}
console.log('✓ every solver and the benchmark handle 0 and 1 stops.');

console.log('\n--- Input validation (F3, F7) ---');
const expectCode = (code, fn, label) => assert.throws(fn, (e) => e instanceof V.QFlowInputError && e.code === code && e.message.length > 10, label);
{
  const ok = [DEPOT, stop(1), stop(2)], m = V.buildCostMatrix(ok, 1);
  expectCode('bad-demand', () => V.runQPSO([DEPOT, stop(1, { demand: NaN })], m, 80, 2), 'NaN demand');
  expectCode('bad-demand', () => V.runGA([DEPOT, stop(1, { demand: -5 })], m, 80, 2), 'negative demand');
  expectCode('bad-time', () => V.runSA([DEPOT, stop(1, { readyTime: 300, dueTime: 100 })], m, 80, 2), 'window closes before it opens');
  expectCode('bad-location', () => V.runACO([DEPOT, stop(1, { lat: 123 })], m, 80, 2), 'latitude out of range');
  expectCode('bad-location', () => V.runQPSO([DEPOT, { id: 1, demand: 5 }], m, 80, 2), 'missing coordinates');
  expectCode('bad-capacity', () => V.runQPSO(ok, m, 0, 2), 'capacity 0');
  expectCode('bad-fleet', () => V.runQPSO(ok, m, 80, 0), '0 vehicles');
  expectCode('bad-fleet', () => X.runPSO(ok, m, 80, 1.5), 'fractional fleet');
  expectCode('no-depot', () => V.runFullBenchmark([], m, 80, 2), 'no depot');
  expectCode('bad-traffic', () => V.buildCostMatrix(ok, NaN), 'NaN traffic');
  expectCode('bad-traffic', () => V.buildCostMatrix(ok, -1), 'negative traffic');
  expectCode('bad-traffic', () => V.buildCostMatrix(ok, 1, null, { segmentVariation: 2 }), 'variation out of range');
  const big = V.generateBenchmarkInstance(V.MAX_CUSTOMERS + 1, undefined, { seed: 1 });
  expectCode('too-many-stops', () => V.runFullBenchmark(big, { dist: [], time: [] }, 80, 30), 'more than MAX_CUSTOMERS');
  assert.doesNotThrow(() => V.validateInstance(V.generateBenchmarkInstance(V.MAX_CUSTOMERS, undefined, { seed: 1 }), 80, 30), 'exactly MAX_CUSTOMERS is allowed');
  const inc = V.buildCostMatrix(ok, 1, { 0: { 1: NaN, 2: -3 } });
  assert.ok(inc.time.every((row) => Array.from(row).every(Number.isFinite)), 'invalid incident delays are ignored, not propagated');
}
console.log('✓ invalid demand, time windows, coordinates, capacity, fleet, traffic and oversized inputs are rejected with structured errors.');

console.log('\n--- Infeasible instances are flagged (F2) ---');
{
  const heavy = [DEPOT, stop(1, { demand: 200 }), stop(2)], m = V.buildCostMatrix(heavy, 1);
  const b = V.runFullBenchmark(heavy, m, 80, 2, { runs: 2, maxEvaluations: 200, seed: 3 });
  assert.strictEqual(b.anyFeasible, false, 'no algorithm can carry a 200 kg stop in 80 kg vehicles');
  assert.ok(b.results.every((r) => r.feasible === false && r.violations.capacityKg > 0), 'every plan reports its overload');
  assert.ok(b.results.every((r) => r.stats.feasibleRatePct === 0));
  assert.ok(b.diagnostics.some((d) => d.code === 'stop-too-heavy'), 'diagnostics name the cause');
  const many = [DEPOT, ...[1, 2, 3, 4, 5].map((i) => stop(i, { demand: 40 }))];
  assert.ok(V.instanceDiagnostics(many, 80, 2).some((d) => d.code === 'fleet-too-small'), '200 kg demand for a 160 kg fleet');
  const fine = V.generateBenchmarkInstance(8, undefined, { seed: 1 }), mf = V.buildCostMatrix(fine, 1.4);
  const bf = V.runFullBenchmark(fine, mf, 80, 2, { runs: 3, maxEvaluations: 600, seed: 1 });
  assert.strictEqual(bf.anyFeasible, true);
  for (const r of bf.results) {
    assert.ok(typeof r.feasible === 'boolean' && r.violations);
    assert.ok(r.stats.feasibleRatePct >= 0 && r.stats.feasibleRatePct <= 100);
    assert.ok(r.stats.median >= r.stats.best - 1e-9 && r.stats.median <= r.stats.worst + 1e-9, 'median within range');
  }
}
console.log('✓ impossible demand gives feasible=false, violations, 0% feasibility rate and a diagnosis.');

console.log('\n--- Depot closing time (F4) ---');
{
  const nodes = [Object.assign({}, DEPOT, { dueTime: 30 }), stop(1, { lat: 17.6, lng: 78.9, dueTime: 9999 })], m = V.buildCostMatrix(nodes, 1);
  for (const [k, fn] of Object.entries(SOLVERS)) {
    const r = fn(nodes, m, 80, 1, { seed: 1, maxEvaluations: 50 });
    const late = r.routes[0].finishTime - 30;
    assert.ok(late > 60 && Math.abs(r.timeViolations - late) < 0.11, `${k}: return after closing counted (${r.timeViolations} vs ${late.toFixed(1)})`);
    assert.strictEqual(r.feasible, false, `${k}: late return is not feasible`);
    assertValidSolution(r, nodes, m, 80, 1);
  }
}
console.log('✓ returning after the depot closes is lateness for the sequence evaluator and for Clarke-Wright routes.');

console.log('\n--- Warm-start re-planning (F6) ---');
{
  for (let s = 1; s <= 15; s++) {
    const nodes = V.generateBenchmarkInstance(15, undefined, { seed: s });
    const r = X.dynamicReplan(nodes, 80, 3, 0.8, 1.9, { maxEvaluations: 800, seed: s });
    assert.strictEqual(r.warmStart, true);
    assert.ok(r.replanned.cost <= r.staleUnderShock.cost + 0.01, `seed ${s}: re-plan ${r.replanned.cost} not worse than keeping the plan ${r.staleUnderShock.cost}`);
  }
  const nodes = V.generateBenchmarkInstance(6, undefined, { seed: 2 }), m = V.buildCostMatrix(nodes, 1);
  const bad = V.runQPSO(nodes, m, 80, 2, { seed: 4, maxEvaluations: 300, initialTours: [[1, 1, 2], [9, 8], 'x', null] });
  assert.strictEqual(bad.variant.warmStartTours, 0, 'invalid warm-start tours are ignored');
  assertValidSolution(bad, nodes, m, 80, 2);
  const tour = [6, 5, 4, 3, 2, 1];
  const warm = V.runQPSO(nodes, m, 80, 2, { seed: 4, maxEvaluations: 300, initialTours: [tour] });
  assert.ok(warm.bestCost <= V.evaluateTourSequence(tour, nodes, m, 80, 2).cost + 0.01, 'never worse than the warm-start tour');
}
console.log('✓ re-plans are never worse than the stale plan (15 seeds); bad warm-start tours are ignored.');

console.log('\n--- One objective for every algorithm ---');
{
  const nodes = V.generateBenchmarkInstance(12, undefined, { seed: 7 }), m = V.buildCostMatrix(nodes, 1.3, null, { timeOfDayMin: 540, segmentVariation: 0.4, seed: 7 });
  const b = V.runFullBenchmark(nodes, m, 80, 3, { runs: 2, maxEvaluations: 600, seed: 7 });
  for (const r of b.results) {
    const again = V.evaluateRoutes(r.routes.map((x) => x.customers), nodes, m, 80, 3);
    assert.ok(Math.abs(again.cost - r.bestCost) < 0.01, `${r.key}: reported cost ${r.bestCost} = re-evaluated ${again.cost.toFixed(2)} on the shared matrix`);
  }
  assert.strictEqual(b.traffic.source, 'simulated');
}
console.log('✓ every algorithm\'s reported cost matches a re-evaluation on the same simulated matrix.');

console.log('\n--- Simulated traffic model (F13) ---');
{
  const nodes = V.generateBenchmarkInstance(10, undefined, { seed: 5 });
  const plain = V.buildCostMatrix(nodes, 1.2);
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
    if (i !== j) assert.ok(Math.abs(plain.time[i][j] - V.computeCongestedTime(plain.dist[i][j], 40, 1.2)) < 1e-9, 'no options = original uniform model');
  }
  assert.strictEqual(plain.traffic.source, 'simulated');
  assert.strictEqual(plain.traffic.timeFactor, 1);
  const a = V.buildCostMatrix(nodes, 1, null, { timeOfDayMin: 540, segmentVariation: 0.5, seed: 9 });
  const b = V.buildCostMatrix(nodes, 1, null, { timeOfDayMin: 540, segmentVariation: 0.5, seed: 9 });
  const c = V.buildCostMatrix(nodes, 1, null, { timeOfDayMin: 540, segmentVariation: 0.5, seed: 10 });
  assert.deepStrictEqual(a.time.map((r) => Array.from(r)), b.time.map((r) => Array.from(r)), 'same seed = same per-road pattern');
  assert.notDeepStrictEqual(a.time.map((r) => Array.from(r)), c.time.map((r) => Array.from(r)), 'different seed = different pattern');
  let varies = false;
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
    assert.strictEqual(a.time[i][j], a.time[j][i], 'per-road traffic is symmetric');
    if (i !== j && Math.abs(a.time[i][j] / a.dist[i][j] - a.time[0][1] / a.dist[0][1]) > 1e-6) varies = true;
  }
  assert.ok(varies, 'congestion varies by road segment');
  const p = V.trafficProfile;
  assert.ok(p(540) > p(180) && p(1110) > p(180) && p(1110) > p(780), 'peaks at 09:00 and 18:30 above night and midday');
  assert.strictEqual(p(-60), p(1380), 'profile wraps around midnight');
  const extreme = V.buildCostMatrix(nodes, 50, null, { timeOfDayMin: 1110, segmentVariation: 1, seed: 1 });
  const cap = V.computeCongestedTime(1, 40, 3) / V.computeCongestedTime(1, 40, 0);
  for (let i = 1; i < nodes.length; i++) {
    const ratio = extreme.time[0][i] / V.computeCongestedTime(extreme.dist[0][i], 40, 0);
    assert.ok(Number.isFinite(extreme.time[0][i]) && ratio <= cap + 1e-9, 'V/C clamped, travel times finite');
  }
}
console.log('✓ default model unchanged; time-of-day and per-road variation reproducible, symmetric, clamped and labelled simulated.');

console.log('\n--- Page scripts call only defined functions (F1) ---');
{
  const SRC = path.join(__dirname, '..', 'src');
  const shared = ['safe-html.js', 'net.js', 'emissions.js', 'config.js', 'ui.js', 'i18n.js', 'location.js', 'geocode.js', 'routing.js', 'swarm-sim.js', 'map.js', 'trips.js', 'mode.js', 'insights.js'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const PREFIX = /^(render|draw|recompute|update|run|compute|show|build|place|select|start|stop|fail|maybe|collect|redraw|reset|refresh|apply|set|mark|validate)[A-Z]/;
  const missing = [];
  for (const page of fs.readdirSync(SRC).filter((f) => f.endsWith('.html'))) {
    const inline = (fs.readFileSync(path.join(SRC, page), 'utf8').match(/<script>[\s\S]*?<\/script>/g) || []).join('\n');
    const code = shared + inline;
    const defined = new Set([...code.matchAll(/function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1] || m[2]));
    const BROWSER = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame']);
    for (const m of inline.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)) if (PREFIX.test(m[1]) && !defined.has(m[1]) && !BROWSER.has(m[1])) missing.push(`${page}: ${m[1]}()`);
  }
  assert.deepStrictEqual([...new Set(missing)], [], 'undefined functions called: ' + missing.join(', '));
}
console.log('✓ no page calls an undefined render/draw/recompute/... function.');

console.log('\n--- Route preferences pick the right route (F19) ---');
{
  const vm = require('vm');
  const ctx = { console, Math, Object, Array, JSON };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'routing.js'), 'utf8'), ctx);
  // A is fastest by 1 min but worst on everything else; B is a close second; C is slow.
  const routes = [
    { id: 'A', durationMin: 20, distanceKm: 30, signals: 20, co2Grams: 4000 },
    { id: 'B', durationMin: 21, distanceKm: 18, signals: 6, co2Grams: 2500 },
    { id: 'C', durationMin: 40, distanceKm: 12, signals: 4, co2Grams: 1900 }
  ];
  const pick = (pref) => vm.runInContext(`qflowScoreRoutes(${JSON.stringify(routes)}, '${pref}')[0].id`, ctx);
  assert.strictEqual(pick('fast'), 'A', 'Fastest returns the minimum-time route');
  assert.strictEqual(pick('road'), 'C', 'Shortest Distance returns the shortest route');
  assert.strictEqual(pick('smooth'), 'C', 'Fewer Signals returns the route with fewest signals');
  assert.strictEqual(pick('green'), 'C', 'Greenest returns the lowest-CO2 route');
  assert.strictEqual(pick('balanced'), 'B', 'Balanced trades the objectives off');
}
console.log('✓ Fastest / Shortest / Fewer Signals / Greenest return the route that is best on their own metric; Balanced blends them.');

console.log('\n--- No fabricated live-data claims or invented outcome numbers (F9-F12) ---');
{
  const SRC = path.join(__dirname, '..', 'src');
  const pages = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
  const BANNED = [
    /live grid density/i, /under live conditions/i, /LIVE TELEMETRY/, /Real-Time Road Incidents/i, /REAL-TIME TRAFFIC/i,
    /MONITORING ACTIVE/, /\b\d+ nearby vehicles alerted/i, /predicts [\d.]+ minutes saved/i, /\d+ traffic signals preempted/i,
    /CO₂ Avoided/, /Active Nodes/, /98% Flow/, /QPSO \(OPTIMAL\)/, />Live Network</
  ];
  const hits = [];
  for (const p of pages) {
    const html = fs.readFileSync(path.join(SRC, p), 'utf8');
    for (const re of BANNED) if (re.test(html)) hits.push(`${p}: ${re}`);
  }
  assert.deepStrictEqual(hits, [], 'fabricated or live-data claims: ' + hits.join(', '));
  const net = fs.readFileSync(path.join(SRC, 'network.html'), 'utf8');
  const conv = net.slice(net.indexOf('const convergencePct'), net.indexOf('const convergencePct') + 120);
  assert.doesNotMatch(conv, /Math\.random/, 'swarm convergence figure is measured, not random');
  for (const p of ['network.html', 'incidents.html', 'vrp.html']) assert.match(fs.readFileSync(path.join(SRC, p), 'utf8'), /SIMULAT/i, `${p} says its traffic is simulated`);
  for (const p of ['plan.html', 'results.html']) assert.match(fs.readFileSync(path.join(SRC, p), 'utf8'), /NO LIVE TRAFFIC/, `${p} shows its data source`);
}
console.log('✓ no "live"/"real-time" claims, invented outcome numbers or random metrics; simulated pages and data sources are labelled.');
