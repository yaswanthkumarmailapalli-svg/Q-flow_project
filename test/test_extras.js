const V = require('../src/vrp-engine.js'), X = require('../src/vrp-extras.js');
const { assert, assertSameOutput, assertValidSolution, assertSeedRecorded } = require('./test_helpers.js');

const CAP = 80, VEH = 3, EPS = 1e-6;
const heuristics = {
  QPSO: V.runQPSO, PSO: X.runPSO, GA: V.runGA, ACO: V.runACO, SA: V.runSA,
  CW: (n, m, c, v) => V.runClarkeWright(n, m, c, v)
};
// Clarke-Wright builds its own routes, outside the sequence-split space the exact
// solver enumerates, so it is validated but not required to be >= the exact cost.
const SPLIT_SPACE = new Set(['QPSO', 'PSO', 'GA', 'ACO', 'SA']);

console.log('--- Exact optimum vs heuristics (several fixed seeds) ---');
for (const seed of [1, 2, 3]) {
  const nodes = V.generateBenchmarkInstance(8, undefined, { seed }), m = V.buildCostMatrix(nodes, 1.4);
  const ex = X.runExact(nodes, m, CAP, VEH);
  assert.ok(!ex.skipped && ex.evaluated === 40320, 'exact must enumerate all 8! orders');
  assertValidSolution(ex, nodes, m, CAP, VEH);
  const line = [`seed ${seed}: exact ${ex.bestCost}`];
  for (const [k, fn] of Object.entries(heuristics)) {
    const r = fn(nodes, m, CAP, VEH, { maxIterations: 60, seed });
    assertValidSolution(r, nodes, m, CAP, VEH);
    if (SPLIT_SPACE.has(k)) assert.ok(r.bestCost >= ex.bestCost - EPS, `${k} (${r.bestCost}) beat the exact optimum (${ex.bestCost}) at seed ${seed}`);
    if (k !== 'CW') {
      assert.strictEqual(r.seed, seed, `${k} must report the seed it used`);
      assertSameOutput(r, fn(nodes, m, CAP, VEH, { maxIterations: 60, seed }), `${k} seed ${seed}`);
    }
    line.push(`${k} ${r.bestCost}`);
  }
  console.log(line.join(' | '));
}
console.log('✓ No metaheuristic beats the exhaustive split optimum; all solutions valid and reproducible.');

console.log('\n--- Injected rng ---');
{
  const nodes = V.generateBenchmarkInstance(8, undefined, { seed: 9 }), m = V.buildCostMatrix(nodes, 1.4);
  const viaSeed = X.runPSO(nodes, m, CAP, VEH, { maxIterations: 30, seed: 77 });
  const viaRng = X.runPSO(nodes, m, CAP, VEH, { maxIterations: 30, rng: V.makeRng(77) });
  assertSameOutput(viaSeed, viaRng, 'config.rng equivalent to config.seed');
  const def = V.runQPSO(nodes, m, CAP, VEH, { maxIterations: 30 });
  assertSeedRecorded(def, 'default-seeded QPSO');
  assertSameOutput(def, V.runQPSO(nodes, m, CAP, VEH, { maxIterations: 30, seed: def.seed }), 'default seed replay');
}
console.log('✓ config.rng and default seeds behave.');

console.log('\n--- Road graph: Dijkstra vs QPSO shortest path ---');
for (const seed of [11, 12]) {
  const g = X.makeGridGraph(8, 8, { congestion: 1.3, seed });
  assert.strictEqual(g.seed, seed);
  assert.deepStrictEqual(g.adj, X.makeGridGraph(8, 8, { congestion: 1.3, seed }).adj, 'same seed -> same graph');
  const d = X.dijkstra(g, 0, 63), qs = X.qpsoShortestPath(g, 0, 63, { seed });
  assert.strictEqual(qs.seed, seed);
  assert.ok(qs.path[0] === 0 && qs.path[qs.path.length - 1] === 63, 'QPSO path must connect src to dst');
  assert.ok(qs.cost >= d.cost - EPS, `QPSO path (${qs.cost}) beat Dijkstra (${d.cost})`);
  assertSameOutput(qs, X.qpsoShortestPath(g, 0, 63, { seed }), 'qpsoShortestPath');
  console.log(`seed ${seed}: dijkstra ${d.cost.toFixed(2)} | qpso ${qs.cost.toFixed(2)} (${qs.path.length} nodes)`);
}
console.log('✓ Shortest-path properties hold.');

console.log('\n--- Multi-run statistics ---');
{
  const nodes = V.generateBenchmarkInstance(8, undefined, { seed: 1 }), m = V.buildCostMatrix(nodes, 1.4);
  const mr = X.multiRun(nodes, m, CAP, VEH, 4, { maxEvaluations: 600, seed: 5 });
  assert.strictEqual(mr.seed, 5);
  assert.strictEqual(mr.reference.kind, 'exact');
  assertSameOutput(mr, X.multiRun(nodes, m, CAP, VEH, 4, { maxEvaluations: 600, seed: 5 }), 'multiRun');
  const fns = { QPSO: V.runQPSO, PSO: X.runPSO, GA: V.runGA, ACO: V.runACO, SA: V.runSA };
  for (const [k, v] of Object.entries(mr.algos)) {
    assert.strictEqual(v.seeds.length, 4);
    assert.ok(v.gapPct >= -EPS && v.bestGapPct >= -EPS, `${k}: negative optimality gap`);
    assert.strictEqual(v.evaluations, 600, `${k}: equal evaluation budget`);
    assert.ok(v.cost.best <= v.cost.mean + EPS && v.cost.mean <= v.cost.worst + EPS, `${k}: inconsistent stats`);
    // Any individual run can be replayed from its recorded seed.
    assert.strictEqual(fns[k](nodes, m, CAP, VEH, { maxEvaluations: 600, seed: v.seeds[2] }).bestCost, v.costs[2], `${k}: run replay`);
    console.log(`${k} mean ${v.cost.mean.toFixed(1)} gap ${v.gapPct.toFixed(2)}%`);
  }
}
console.log('✓ Multi-run study is reproducible and run-replayable.');

console.log('\n--- Dynamic re-plan ---');
{
  const nodes = V.generateBenchmarkInstance(10, undefined, { seed: 4 });
  const dr = X.dynamicReplan(nodes, CAP, VEH, 0.8, 1.9, { maxIterations: 60, seed: 8 });
  assert.strictEqual(dr.seed, 8);
  assertSameOutput(dr, X.dynamicReplan(nodes, CAP, VEH, 0.8, 1.9, { maxIterations: 60, seed: 8 }), 'dynamicReplan');
  assert.ok(dr.staleUnderShock.timeMin > dr.before.timeMin, 'shock must slow the old plan');
  console.log(dr);
}
console.log('OK');
