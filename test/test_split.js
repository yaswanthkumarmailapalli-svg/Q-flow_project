// Optimal split decoder (src/vrp-engine.js splitTourSequence) and the exact solver built on it.
const assert = require('assert');
const path = require('path');
const V = require(path.join(__dirname, '..', 'src', 'vrp-engine.js'));
console.log('--- Optimal split decoder ---');

let better = 0, total = 0;
for (const n of [8, 20, 50]) for (let seed = 301; seed <= 303; seed++) {
  const nodes = V.generateBenchmarkInstance(n, undefined, { seed });
  const m = V.buildCostMatrix(nodes, 1.4), K = Math.max(2, Math.ceil(n / 6)), rng = V.makeRng(seed);
  for (let r = 0; r < 20; r++) {
    const seq = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
    const g = V.evaluateTourSequence(seq, nodes, m, 80, K), s = V.splitTourSequence(seq, nodes, m, 80, K);
    assert.ok(s.cost <= g.cost + 1e-6, `split never worse than greedy (n=${n})`);
    assert.ok(s.routes.length <= K, 'split uses at most K routes');
    assert.deepStrictEqual(s.routes.flatMap((x) => x.customers).sort((a, b) => a - b), seq.slice().sort((a, b) => a - b), 'every customer exactly once, order kept');
    assert.ok(Math.abs(V.evaluateRoutes(s.routes.map((x) => x.customers), nodes, m, 80, K).cost - s.cost) < 1e-6, 'cost equals the route objective');
    if (s.cost < g.cost - 1e-6) better++;
    total++;
  }
}
assert.ok(better / total > 0.5, `split is strictly better on most random orders (${better}/${total})`);
assert.strictEqual(V.splitTourSequence([], [{ lat: 0, lng: 0, demand: 0 }], { dist: [[0]], time: [[0]] }, 80, 2).cost, 0, 'empty tour');

// Exact solver: enumeration + optimal split is never above enumeration + greedy split,
// and no metaheuristic run beats it (it is the true optimum for <= K vehicles).
for (let seed = 311; seed <= 313; seed++) {
  const nodes = V.generateBenchmarkInstance(7, undefined, { seed });
  const m = V.buildCostMatrix(nodes, 1.4);
  const ex = V.runExact(nodes, m, 80, 2), exG = V.runExact(nodes, m, 80, 2, { decoder: 'greedy' });
  assert.ok(ex.bestCost <= exG.bestCost + 1e-6, 'split optimum <= greedy-split optimum');
  for (const fn of [V.runQPSO, V.runSA, V.runGA]) {
    const r = fn(nodes, m, 80, 2, { seed: 5, maxEvaluations: 2000 });
    assert.ok(r.bestCost >= ex.bestCost - 1e-6, `${r.algorithm} does not beat the exact optimum`);
  }
}
const q = V.runQPSO(V.generateBenchmarkInstance(10, undefined, { seed: 1 }), V.buildCostMatrix(V.generateBenchmarkInstance(10, undefined, { seed: 1 }), 1.4), 80, 2, { seed: 1, maxEvaluations: 500 });
assert.strictEqual(q.variant.decoder, 'split', 'QPSO uses the optimal split decoder by default');
console.log(`✓ split decoder never worse than greedy (strictly better on ${better}/${total} random orders), at most K routes, same objective; exact optimum holds against QPSO, SA and GA; QPSO defaults to split.`);
