/* =====================================================================
   Q-FLOW EXTRAS — closes the remaining SIH26137 gaps
   - Exact solver (optimal over the sequence-split search space) for small VRPs
   - Classical PSO baseline (so QPSO is compared to its direct ancestor)
   - Graph model: weighted road grid + Dijkstra exact shortest path
   - QPSO shortest-path solver (priority-encoded, quantum-inspired position update)
   - Multi-run statistics (mean / std / best / worst / optimality gap)
   - Dynamic traffic re-optimisation (congestion shock mid-day -> re-plan)
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vrp-engine.js'));
  else root.QFlowExtras = factory(root.QFlowVRP);
})(typeof self !== 'undefined' ? self : this, function (V) {
  'use strict';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---------- Exact solver (lives in the engine; re-exported here) ----------
  const runExact = V.runExact;

  // ---------- Classical PSO (inertia + cognitive + social) ----------
  // Uses the same evaluation counter/budget as every other solver.
  function runPSO(nodes, matrix, cap, veh, config = {}) {
    V.validateInstance(nodes, cap, veh, config);
    const t0 = now(), n = nodes.length - 1, { rng, seed } = V.resolveRng(config);
    const E = V.makeEvaluator(nodes, matrix, cap, veh, config);
    const S = config.swarmSize || Math.max(24, Math.min(60, n * 3));
    const T = E.limited ? Infinity : config.maxIterations || 100;
    const w0 = 0.9, w1 = 0.4, c1 = 1.8, c2 = 1.8;
    const P = [];
    let gb = null, gc = Infinity, gev = null; const conv = [], convEvals = [];
    for (let p = 0; p < S && !E.done(); p++) {
      const x = Array.from({ length: n }, () => rng()), v = new Array(n).fill(0);
      const ev = E.eval(V.decodeRandomKeys(x));
      P.push({ x, v, pb: x.slice(), pc: ev.cost });
      if (ev.cost < gc) { gc = ev.cost; gb = x.slice(); gev = ev; }
    }
    conv.push(gc); convEvals.push(E.used);
    for (let it = 1; it <= T && !E.done(); it++) {
      const prog = Math.min(1, E.limited ? E.used / E.budget : it / T);
      const w = w0 - (w0 - w1) * prog;
      for (const q of P) {
        if (E.done()) break;
        for (let d = 0; d < n; d++) {
          q.v[d] = w * q.v[d] + c1 * rng() * (q.pb[d] - q.x[d]) + c2 * rng() * (gb[d] - q.x[d]);
          q.v[d] = Math.max(-0.5, Math.min(0.5, q.v[d]));
          q.x[d] = Math.max(0, Math.min(1, q.x[d] + q.v[d]));
        }
        const ev = E.eval(V.decodeRandomKeys(q.x));
        if (ev.cost < q.pc) { q.pc = ev.cost; q.pb = q.x.slice(); }
        if (ev.cost < gc) { gc = ev.cost; gb = q.x.slice(); gev = ev; }
      }
      conv.push(gc); convEvals.push(E.used);
    }
    return {
      algorithm: 'PSO (Classical Particle Swarm)', type: 'Classical Metaheuristic', seed, ...V.feasibilityOf(gev), bestCost: +gev.cost.toFixed(2),
      totalDistKm: gev.totalDist, totalTimeMin: gev.totalTime, routes: gev.routes, capViolations: gev.totalCapViolations,
      timeViolations: gev.totalTimeViolations, waitTime: gev.totalWaitTime, convergence: conv, convergenceEvals: convEvals,
      evaluations: E.used, maxEvaluations: E.limited ? E.budget : null,
      executionTimeMs: +(now() - t0).toFixed(2), co2Grams: V.co2GramsOf(gev)
    };
  }

  // ---------- Road graph + Dijkstra ----------
  // Grid city: rows x cols intersections, edges have length + BPR congestion.
  // opts.seed / opts.rng (or legacy opts.rand) make the graph reproducible; g.seed records it.
  function makeGridGraph(rows = 8, cols = 8, opts = {}) {
    const { rng: rnd, seed } = V.resolveRng(opts.rand && !opts.rng ? Object.assign({}, opts, { rng: opts.rand }) : opts), N = rows * cols, adj = Array.from({ length: N }, () => []);
    const id = (r, c) => r * cols + c;
    const addEdge = (a, b) => {
      const len = 0.4 + rnd() * 0.8;                 // km
      const vc = Math.max(0.2, (opts.congestion ?? 1) * (0.4 + rnd() * 1.1)); // V/C ratio
      const t = V.computeCongestedTime(len, 40, vc);  // minutes, BPR
      adj[a].push({ to: b, dist: len, time: t }); adj[b].push({ to: a, dist: len, time: t });
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) addEdge(id(r, c), id(r, c + 1));
      if (r + 1 < rows) addEdge(id(r, c), id(r + 1, c));
    }
    return { rows, cols, N, adj, seed, coord: i => ({ r: Math.floor(i / cols), c: i % cols }) };
  }

  function dijkstra(g, src, dst, weight = 'time') {
    const t0 = now(), d = new Array(g.N).fill(Infinity), prev = new Array(g.N).fill(-1), done = new Array(g.N).fill(false);
    d[src] = 0;
    for (let k = 0; k < g.N; k++) {
      let u = -1; for (let i = 0; i < g.N; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0 || d[u] === Infinity) break; done[u] = true; if (u === dst) break;
      for (const e of g.adj[u]) if (d[u] + e[weight] < d[e.to]) { d[e.to] = d[u] + e[weight]; prev[e.to] = u; }
    }
    const path = []; for (let v = dst; v !== -1; v = prev[v]) path.unshift(v);
    return { algorithm: 'Dijkstra (Exact)', cost: d[dst], path: path[0] === src ? path : [], executionTimeMs: now() - t0 };
  }

  function pathCost(g, path, weight) {
    let s = 0;
    for (let i = 0; i + 1 < path.length; i++) { const e = g.adj[path[i]].find(x => x.to === path[i + 1]); if (!e) return Infinity; s += e[weight]; }
    return s;
  }

  // QPSO for shortest path: particle = node priority vector; decoded by a
  // priority-guided self-avoiding walk from src. Quantum-inspired delta-well update (classical).
  function qpsoShortestPath(g, src, dst, config = {}) {
    const t0 = now(), { rng, seed } = V.resolveRng(config), weight = config.weight || 'time', S = config.swarmSize || 30, T = config.maxIterations || 80;
    const decode = x => {
      const path = [src], seen = new Set([src]); let u = src;
      while (u !== dst && path.length < g.N) {
        let best = null, bv = -Infinity;
        for (const e of g.adj[u]) if (!seen.has(e.to)) {
          // priority + small bias toward destination keeps walks short
          const cu = g.coord(e.to), cd = g.coord(dst);
          const v = x[e.to] - 0.04 * (Math.abs(cu.r - cd.r) + Math.abs(cu.c - cd.c));
          if (v > bv) { bv = v; best = e.to; }
        }
        if (best === null) return null; path.push(best); seen.add(best); u = best;
      }
      return u === dst ? path : null;
    };
    const fit = x => { const p = decode(x); return p ? pathCost(g, p, weight) : 1e6; };
    const P = []; let gb = null, gc = Infinity; const conv = [];
    for (let i = 0; i < S; i++) {
      const x = Array.from({ length: g.N }, () => rng()), c = fit(x);
      P.push({ x, pb: x.slice(), pc: c }); if (c < gc) { gc = c; gb = x.slice(); }
    }
    conv.push(gc);
    for (let it = 1; it <= T; it++) {
      const a = 1.0 - 0.5 * it / T, mb = new Array(g.N).fill(0);
      for (const q of P) for (let d = 0; d < g.N; d++) mb[d] += q.pb[d] / S;
      for (const q of P) {
        for (let d = 0; d < g.N; d++) {
          const phi = rng(), p = phi * q.pb[d] + (1 - phi) * gb[d];
          const step = a * Math.abs(mb[d] - q.x[d]) * Math.log(1 / Math.max(1e-10, rng()));
          q.x[d] = Math.max(0, Math.min(1, rng() >= 0.5 ? p + step : p - step));
        }
        const c = fit(q.x);
        if (c < q.pc) { q.pc = c; q.pb = q.x.slice(); }
        if (c < gc) { gc = c; gb = q.x.slice(); }
      }
      conv.push(gc);
    }
    return { algorithm: 'QPSO Shortest Path (quantum-inspired)', seed, cost: gc, path: decode(gb) || [], convergence: conv, executionTimeMs: now() - t0 };
  }

  // ---------- Multi-run statistics ----------
  const stats = V.summarize;
  // N seeded runs of QPSO, PSO, GA, ACO, SA under one shared evaluation budget
  // (config.maxEvaluations, default V.defaultEvaluationBudget(n)). Gap is vs the
  // exact optimum (enumeration + optimal split) when includeExact and n <= 9, else vs the best cost found.
  // Run i of algorithm k uses algos[k].seeds[i], so any run can be replayed.
  function multiRun(nodes, matrix, cap, veh, runs = 10, config = {}, includeExact = true) {
    const b = V.runFullBenchmark(nodes, matrix, cap, veh, Object.assign({}, config, {
      runs, algorithms: { QPSO: V.runQPSO, PSO: runPSO, GA: V.runGA, ACO: V.runACO, SA: V.runSA },
      exactLimit: includeExact ? (config.exactLimit ?? 9) : -1
    }));
    const out = { seed: b.seed, runs: b.runs, maxEvaluations: b.maxEvaluations, reference: b.reference, algos: {}, exact: b.exact, diagnostics: b.diagnostics };
    for (const [k, s] of Object.entries(b.summary)) {
      if (k === 'CW') continue;
      out.algos[k] = {
        seeds: s.seeds, costs: s.costs, cost: { mean: s.mean, std: s.std, best: s.best, worst: s.worst, median: s.median },
        feasibleRatePct: s.feasibleRatePct,
        timeMs: s.meanTimeMs, evaluations: s.meanEvaluations, convergence: s.meanConvergence,
        convergenceByEvals: s.convergenceByEvals, gapPct: s.gapPct, bestGapPct: s.bestGapPct, hitRatePct: s.hitRatePct
      };
    }
    const cw = b.results.find(r => r.key === 'CW');
    out.clarkeWright = Object.assign({}, b.summary.CW, {
      algorithm: cw.algorithm, notes: cw.notes, respectsTimeWindows: cw.respectsTimeWindows,
      vehiclesNeeded: cw.vehiclesNeeded, fleetExcess: cw.fleetExcess, timeViolations: cw.timeViolations
    });
    return out;
  }

  // ---------- Dynamic traffic re-optimisation ----------
  // Plan under normal traffic, then a congestion shock hits: compare
  // (a) keeping the old plan vs (b) re-optimising with QPSO under new traffic.
  function dynamicReplan(nodes, cap, veh, baseTraffic = 0.8, shockTraffic = 1.9, config = {}) {
    const m0 = V.buildCostMatrix(nodes, baseTraffic), m1 = V.buildCostMatrix(nodes, shockTraffic);
    const seed = V.resolveSeed(config);
    const plan0 = V.runQPSO(nodes, m0, cap, veh, Object.assign({}, config, { rng: undefined, seed: V.deriveSeed(seed, 0) }));
    const seq = plan0.routes.flatMap(r => r.customers);
    const stale = V.evaluateTourSequence(seq, nodes, m1, cap, veh);
    // Warm start (default): the stale plan seeds the swarm, so the re-plan is never
    // worse than keeping it. config.warmStart = false re-plans from scratch.
    const warm = config.warmStart === false ? [] : [seq];
    const replan = V.runQPSO(nodes, m1, cap, veh, Object.assign({}, config, { rng: undefined, seed: V.deriveSeed(seed, 1), initialTours: warm }));
    return {
      seed, planSeed: plan0.seed, replanSeed: replan.seed, warmStart: warm.length > 0,
      before: { cost: plan0.bestCost, timeMin: plan0.totalTimeMin, distKm: plan0.totalDistKm },
      staleUnderShock: { cost: +stale.cost.toFixed(2), timeMin: stale.totalTime, distKm: stale.totalDist, lateMin: stale.totalTimeViolations },
      replanned: { cost: replan.bestCost, timeMin: replan.totalTimeMin, distKm: replan.totalDistKm, lateMin: replan.timeViolations, ms: replan.executionTimeMs },
      savingPct: stale.cost > 0 ? +((stale.cost - replan.bestCost) / stale.cost * 100).toFixed(1) : 0
    };
  }

  return { makeRng: V.makeRng, runExact, runPSO, makeGridGraph, dijkstra, qpsoShortestPath, multiRun, dynamicReplan, stats };
});
