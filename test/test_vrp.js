const VRP = require('../src/vrp-engine.js');
const { assert, assertSameOutput, assertValidSolution, assertSeedRecorded } = require('./test_helpers.js');

const CENTER = { lat: 17.385, lng: 78.4867 };
const SEED = 20260101;

console.log('--- TEST 0: Seeded PRNG ---');
{
  const a = VRP.makeRng(123), b = VRP.makeRng(123), c = VRP.makeRng(124);
  const sa = Array.from({ length: 1000 }, a), sb = Array.from({ length: 1000 }, b), sc = Array.from({ length: 1000 }, c);
  assert.deepStrictEqual(sa, sb, 'same seed must give the same stream');
  assert.notDeepStrictEqual(sa, sc, 'different seeds should give different streams');
  assert.ok(sa.every(x => x >= 0 && x < 1), 'rng output must lie in [0, 1)');
  const mean = sa.reduce((s, x) => s + x, 0) / sa.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `rng mean ${mean} far from 0.5`);
  assert.strictEqual(a.seed, 123);
  assert.strictEqual(VRP.makeRng('route-A').seed, VRP.makeRng('route-A').seed, 'string seeds hash stably');
  const fresh = VRP.makeRng();
  assert.ok(Number.isInteger(fresh.seed), 'unseeded rng still reports the seed it picked');
  assert.deepStrictEqual(Array.from({ length: 20 }, fresh), Array.from({ length: 20 }, VRP.makeRng(fresh.seed)), 'reported seed replays the stream');
}
console.log('✓ mulberry32 is deterministic, bounded and replayable.');

console.log('\n--- TEST 1: Instance Generation & BPR Matrix ---');
const nodes = VRP.generateBenchmarkInstance(12, CENTER, { seed: SEED });
assert.strictEqual(nodes.length, 13);
assert.strictEqual(nodes.seed, SEED, 'instance records its seed');
assert.deepStrictEqual(nodes, VRP.generateBenchmarkInstance(12, CENTER, { seed: SEED }), 'same seed -> same instance');
assert.notDeepStrictEqual(nodes, VRP.generateBenchmarkInstance(12, CENTER, { seed: SEED + 1 }), 'different seed -> different instance');
assert.deepStrictEqual(nodes, VRP.generateBenchmarkInstance(12, CENTER, { rng: VRP.makeRng(SEED) }), 'config.rng is equivalent to config.seed');
assert.ok(!Object.keys(nodes).includes('seed'), 'seed is non-enumerable on the node array');
for (const c of nodes.slice(1)) {
  assert.ok(c.demand >= 5 && c.demand <= 22 && c.readyTime < c.dueTime, `bad generated customer ${c.id}`);
}
console.log(`Generated ${nodes.length} nodes (1 depot + ${nodes.length - 1} customers), seed ${nodes.seed}.`);

const freeFlowMatrix = VRP.buildCostMatrix(nodes, 0.5);
const congestedMatrix = VRP.buildCostMatrix(nodes, 1.8);
for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
  if (i !== j) assert.ok(congestedMatrix.time[i][j] > freeFlowMatrix.time[i][j], `BPR: congested ${i}->${j} must exceed free flow`);
}
console.log('✓ Seeded instances and BPR congestion model verified.');

console.log('\n--- TEST 2: Multi-Algorithm Benchmark Suite ---');
const vehicleCap = 75;
const fleetSize = 3;
const cfg = { runs: 3, maxEvaluations: 1500, seed: SEED };
const bench = VRP.runFullBenchmark(nodes, congestedMatrix, vehicleCap, fleetSize, cfg);
assert.strictEqual(bench.seed, SEED, 'benchmark records its base seed');
assert.strictEqual(bench.runs, 3);
assert.strictEqual(bench.maxEvaluations, 1500);
assert.strictEqual(bench.reference.kind, 'best-found', '12 customers is above the default exact limit');

console.log(`Best Algorithm: ${bench.bestAlgorithm.algorithm} (Cost: ${bench.bestAlgorithm.bestCost})`);
const solvers = { QPSO: VRP.runQPSO, 'Genetic Algorithm': VRP.runGA, 'Ant Colony': VRP.runACO, 'Simulated Annealing': VRP.runSA };
bench.results.forEach(r => {
  console.log(`- ${r.algorithm.padEnd(46)}: Dist=${String(r.totalDistKm).padEnd(6)} km | TimeViol=${r.timeViolations} | CapViol=${r.capViolations} | seed=${r.seed ?? '-'}`);
  assert.ok(r.convergence && r.convergence.length > 0, `${r.algorithm} missing convergence data`);
  for (let i = 1; i < r.convergence.length; i++) assert.ok(r.convergence[i] <= r.convergence[i - 1] + 1e-9, `${r.algorithm}: best-so-far curve must not increase`);
  assertValidSolution(r, nodes, congestedMatrix, vehicleCap, fleetSize);
  const st = r.stats;
  assert.ok(st.best <= st.mean + 1e-9 && st.mean <= st.worst + 1e-9 && st.std >= 0, `${r.algorithm}: inconsistent stats`);
  assert.ok(st.gapPct >= -1e-9 && st.bestGapPct >= -1e-9, `${r.algorithm}: negative gap vs best-found reference`);
  assert.strictEqual(r.bestCost, st.best, `${r.algorithm}: representative run is the best run`);
  const key = Object.keys(solvers).find(k => r.algorithm.startsWith(k));
  if (key) {
    assertSeedRecorded(r, r.algorithm);
    assert.strictEqual(st.costs.length, 3);
    assert.strictEqual(r.evaluations, 1500, `${r.algorithm}: must use exactly the shared budget`);
    assert.strictEqual(st.meanEvaluations, 1500, `${r.algorithm}: every run uses the shared budget`);
    // Any single algorithm from the benchmark can be replayed from its recorded seed.
    const { distImprovementPct, ...standalone } = r; // benchmark-only field
    delete standalone.key;
    delete standalone.stats;
    assertSameOutput(solvers[key](nodes, congestedMatrix, vehicleCap, fleetSize, { maxEvaluations: 1500, seed: r.seed }),
      standalone, `${r.algorithm} replay`);
  }
});
assert.strictEqual(new Set(bench.results.filter(r => r.seed !== undefined).map(r => r.seed)).size, 4, 'each solver gets its own derived seed');
assertSameOutput(bench, VRP.runFullBenchmark(nodes, congestedMatrix, vehicleCap, fleetSize, cfg), 'runFullBenchmark');
assert.ok(bench.results.some(r => r === bench.bestAlgorithm));
assert.strictEqual(bench.bestAlgorithm.stats.mean, Math.min(...bench.results.map(r => r.stats.mean)), 'best algorithm is ranked by mean cost');
const unseeded = VRP.runFullBenchmark(nodes, congestedMatrix, vehicleCap, fleetSize, { runs: 2, maxEvaluations: 400 });
assertSeedRecorded(unseeded, 'unseeded benchmark');
assertSameOutput(unseeded, VRP.runFullBenchmark(nodes, congestedMatrix, vehicleCap, fleetSize, { runs: 2, maxEvaluations: 400, seed: unseeded.seed }), 'unseeded benchmark replay');

console.log('\n--- TEST 2b: QPSO building blocks ---');
{
  const r = VRP.makeRng(3);
  for (let t = 0; t < 50; t++) {
    const perm = Array.from({ length: 12 }, (_, i) => i + 1).sort(() => r() - 0.5);
    assert.deepStrictEqual(VRP.decodeRandomKeys(Array.from(VRP.encodeRandomKeys(perm, r))), perm, 'random-key encode/decode round trip');
  }
  const isPerm = (seq) => seq.length === 12 && new Set(seq).size === 12 && seq.every(c => c >= 1 && c <= 12);
  assert.ok(isPerm(VRP.clarkeWrightSequence(nodes, congestedMatrix, vehicleCap)), 'CW seed is a permutation');
  assert.ok(isPerm(VRP.nearestNeighbourSequence(congestedMatrix.dist, 12)), 'NN seed is a permutation');
  const q = VRP.runQPSO(nodes, congestedMatrix, vehicleCap, fleetSize, { seed: 1, maxEvaluations: 800, alphaMax: 1.4 });
  assert.ok(q.variant.alphaMax < 0.97, 'alpha is clamped below the QPSO stability bound');
  assert.ok(q.evaluations === 800 && q.convergenceEvals[q.convergenceEvals.length - 1] <= 800, 'local search respects the budget');
  for (const mode of ['lamarckian', 'baldwinian', 'none']) {
    const res = VRP.runQPSO(nodes, congestedMatrix, vehicleCap, fleetSize, { seed: 2, maxEvaluations: 800, localSearch: mode });
    assertValidSolution(res, nodes, congestedMatrix, vehicleCap, fleetSize);
    assert.strictEqual(res.evaluations, 800, `${mode}: budget`);
  }
}
console.log('✓ Encoding, heuristic seeds, alpha clamp and budget accounting verified.');

console.log('\n--- TEST 2c: Clarke-Wright labelling and time windows ---');
{
  assert.strictEqual(VRP.CW_LABEL, 'Clarke-Wright Savings (greedy constructive heuristic)');
  const q = bench.results.find(r => r.key === 'QPSO');
  assert.ok(/Quantum-Inspired/.test(q.algorithm) && /Quantum-Inspired/.test(q.type), 'QPSO is labelled quantum-inspired');
  for (const seed of [1, 2, 3, 4, 5, SEED]) {
    for (const size of [8, 12, 20]) {
      const nd = VRP.generateBenchmarkInstance(size, CENTER, { seed });
      const mx = VRP.buildCostMatrix(nd, 1.4);
      const veh = Math.max(2, Math.ceil(size / 6));
      const tw = VRP.runClarkeWright(nd, mx, 80, veh);
      const classic = VRP.runClarkeWright(nd, mx, 80, veh, { timeWindows: false });
      assert.strictEqual(tw.algorithm, VRP.CW_LABEL);
      assert.strictEqual(tw.respectsTimeWindows, true);
      assert.strictEqual(classic.respectsTimeWindows, false);
      assert.ok(classic.notes.some(t => /ignores time windows/i.test(t)), 'classic CW is flagged as ignoring time windows');
      assertValidSolution(tw, nd, mx, 80, veh);
      assertValidSolution(classic, nd, mx, 80, veh);
      // Merges never add lateness, so total lateness <= that of one-stop-per-vehicle routes.
      const singles = VRP.evaluateRoutes(Array.from({ length: size }, (_, i) => [i + 1]), nd, mx, 80, size);
      assert.ok(tw.timeViolations <= singles.totalTimeViolations + 0.11, `CW lateness ${tw.timeViolations} > singleton lateness ${singles.totalTimeViolations}`);
      if (tw.fleetExcess > 0) assert.ok(tw.notes.some(t => /fleet has/.test(t)), 'fleet excess is flagged');
      // evaluateRoutes scores split routes exactly like evaluateTourSequence.
      const seq = VRP.clarkeWrightSequence(nd, mx, 80);
      const a = VRP.evaluateTourSequence(seq, nd, mx, 80, veh);
      const b = VRP.evaluateRoutes(a.routes.map(r => r.customers), nd, mx, 80, veh);
      assert.ok(Math.abs(a.cost - b.cost) < 1e-6, 'evaluateRoutes matches evaluateTourSequence');
    }
  }
}
console.log('✓ Clarke-Wright is labelled correctly, respects time windows when merging, and flags fleet excess.');
console.log('✓ All 5 algorithms produce valid, reproducible solutions.');

console.log('\n--- TEST 3: Scalability Study ---');
const scale = VRP.runScalabilityStudy([10, 25], CENTER, { seed: SEED });
assertSameOutput(scale, VRP.runScalabilityStudy([10, 25], CENTER, { seed: SEED }), 'runScalabilityStudy');
scale.forEach(s => {
  assert.strictEqual(s.seed, SEED);
  [s.qpso, s.ga, s.sa].forEach(a => assertSeedRecorded(a, `scale ${s.nodeCount}`));
  assert.ok(s.qpso.cost > 0 && s.ga.cost > 0 && s.sa.cost > 0);
  console.log(`Scale ${s.nodeCount} Nodes / ${s.vehicles} Vehicles (instance seed ${s.instanceSeed}) -> QPSO ${s.qpso.distKm}km, GA ${s.ga.distKm}km, SA ${s.sa.distKm}km`);
});
console.log('✓ Scalability suite is reproducible.');

console.log('\n>>> ALL ALGORITHM & VRP TESTS PASSED SUCCESSFULLY! <<<');
