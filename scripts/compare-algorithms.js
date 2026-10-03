#!/usr/bin/env node
// Reproducible algorithm comparison for the Q-FLOW VRP engine.
//
//   node scripts/compare-algorithms.js            # full report (a few minutes)
//   node scripts/compare-algorithms.js --quick    # fewer instances, for a smoke check
//   node scripts/compare-algorithms.js --tuning   # the tuning instances (seeds 101-110)
//   node scripts/compare-algorithms.js --cache .bench-cache   # resumable: per-instance
//        results are saved and skipped on re-run. Cache files are keyed by a hash of
//        the engine source, so editing the engine never reuses stale results.
//   --out docs/results.md   also write the report to a file
//   --readme README.md      also refresh the block between <!-- results:start --> and
//                           <!-- results:end --> in that file
//   npm run bench = --cache .bench-cache --out docs/results.md --readme README.md
//
// Method
// - Held-out instances: generateBenchmarkInstance(n, depot, { seed }) with seeds 1..10.
//   QPSO's settings were chosen on a separate tuning set (seeds 101..110) and never
//   adjusted on these.
// - Every stochastic algorithm gets the same objective-evaluation budget per run
//   (engine default: max(2000, min(20000, 300 n))), and N = 10 independent seeded runs.
// - Gap = (mean cost over runs - reference) / reference. Reference = exhaustive
//   optimum (n <= 8: every customer order, each cut into routes by the optimal split
//   decoder, i.e. the true optimum with at most K vehicles) or the best cost any
//   algorithm found on that instance.
// - "Wins" = instances where the algorithm had the lowest mean cost among the
//   metaheuristics; for Clarke-Wright, instances where its single deterministic
//   result is at or below the best metaheuristic mean.
// - Clarke-Wright is the time-window-aware savings variant, scored on its own routes.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const V = require(path.join(__dirname, '..', 'src', 'vrp-engine.js'));
const X = require(path.join(__dirname, '..', 'src', 'vrp-extras.js'));

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const tuning = args.includes('--tuning');
const RUNS = 10;
const seedBase = tuning ? 101 : 1;
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const cacheDir = argVal('--cache');
const outFile = argVal('--out');
const readmeFile = argVal('--readme');
if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
// Fingerprint of everything that determines the results (engine + this script's algorithm set).
const ENGINE_HASH = crypto.createHash('sha1')
  .update(['vrp-engine.js', 'vrp-extras.js', 'emissions.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n'))
  .update('runs=' + 10 + ';algos=QPSO,QPSO-core,QPSO-greedy,PSO,GA,ACO,SA,SA-split;traffic=1.4;cap=80')
  .digest('hex').slice(0, 10);

function instanceSummary(n, seed, veh, budget) {
  const file = cacheDir && path.join(cacheDir, `n${n}-s${seed}-b${budget}-${ENGINE_HASH}.json`);
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = V.generateBenchmarkInstance(n, undefined, { seed });
  const m = V.buildCostMatrix(nodes, 1.4);
  const b = V.runFullBenchmark(nodes, m, 80, veh, { seed, runs: RUNS, maxEvaluations: budget, algorithms: ALGOS, exactLimit: 8 });
  const out = { reference: b.reference, summary: {} };
  for (const [a, s] of Object.entries(b.summary)) {
    out.summary[a] = { mean: s.mean, std: s.std, best: s.best, median: s.median, costs: s.costs, feasibleRuns: s.feasibleRuns, runs: s.runs, gapPct: s.gapPct, bestGapPct: s.bestGapPct, meanTimeMs: s.meanTimeMs, meanEvaluations: s.meanEvaluations };
  }
  if (file) fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

const ALGOS = {
  QPSO: V.runQPSO,
  'QPSO-core': (n, m, c, v, cfg) => V.runQPSO(n, m, c, v, Object.assign({}, cfg, { localSearch: 'none', heuristicSeedFraction: 0 })),
  'QPSO-greedy': (n, m, c, v, cfg) => V.runQPSO(n, m, c, v, Object.assign({}, cfg, { decoder: 'greedy' })),
  PSO: X.runPSO,
  GA: V.runGA,
  ACO: V.runACO,
  SA: V.runSA,
  'SA-split': (n, m, c, v, cfg) => V.runSA(n, m, c, v, Object.assign({}, cfg, { decoder: 'split' }))
};

function study(n, instances, budgetScale = 1) {
  const veh = Math.max(2, Math.ceil(n / 6));
  const budget = Math.round(V.defaultEvaluationBudget(n) * budgetScale);
  const agg = {};
  let example = null;
  for (let k = 0; k < instances; k++) {
    const seed = seedBase + k;
    const b = instanceSummary(n, seed, veh, budget);
    if (!example) example = { seed, ...b };
    const stochastic = Object.keys(ALGOS);
    const bestMean = Math.min(...stochastic.map((a) => b.summary[a].mean));
    for (const [a, s] of Object.entries(b.summary)) {
      const g = agg[a] || (agg[a] = { gap: [], runGaps: [], bestGap: [], cv: [], ms: [], evals: [], wins: 0, feasible: 0, total: 0 });
      g.feasible += s.feasibleRuns; g.total += s.runs;
      g.gap.push(s.gapPct);
      for (const c of s.costs) g.runGaps.push(((c - b.reference.cost) / b.reference.cost) * 100);
      g.bestGap.push(s.bestGapPct);
      g.cv.push((s.std / b.reference.cost) * 100);
      g.ms.push(s.meanTimeMs);
      g.evals.push(s.meanEvaluations);
      // Stochastic algorithms: lowest mean among them. Clarke-Wright: at or below the best metaheuristic mean.
      if (s.mean <= bestMean + 1e-9) g.wins++;
    }
    process.stderr.write(`  n=${n} instance ${seed} done\n`);
  }
  return { n, veh, budget, instances, ref: n <= 8 ? 'exact optimum' : 'best found', agg, example };
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) * (x - m)))); };
const LABEL = {
  CW: 'Clarke-Wright (time-window-aware, 1 deterministic run)',
  QPSO: 'QPSO (optimal split decoder)',
  'QPSO-core': 'QPSO-core (ablation: no local search / seeding)',
  'QPSO-greedy': 'QPSO with greedy decoder (ablation)',
  'SA-split': 'SA with optimal split decoder (fairness check)'
};
const pct = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : x.toFixed(1)) + '%';

function table(r, withTimes) {
  const lines = [];
  lines.push(`### n = ${r.n} customers, ${r.veh} vehicles: ${r.instances} instances x ${RUNS} runs, ${r.budget.toLocaleString()} evaluations per run (gap vs ${r.ref})`);
  lines.push('');
  lines.push('| Algorithm | Gap, mean ± std | Median gap | Best-run gap | Feasible runs | Wins |' + (withTimes ? ' Time/run (ms) |' : '') + ' Evaluations/run |');
  lines.push('|---|---:|---:|---:|---:|---:|' + (withTimes ? '---:|' : '') + '---:|');
  const rows = Object.entries(r.agg).sort((a, b) => avg(a[1].gap) - avg(b[1].gap));
  for (const [a, g] of rows) {
    const gaps = a === 'CW' ? g.gap : g.runGaps;
    lines.push(`| ${LABEL[a] || a} | ${pct(avg(gaps))} ± ${pct(sd(gaps))} | ${pct(med(g.gap))} | ${pct(avg(g.bestGap))} | ${Math.round((100 * g.feasible) / g.total)}% | ${g.wins}/${r.instances} |${withTimes ? ` ${avg(g.ms).toFixed(1)} |` : ''} ${Math.round(avg(g.evals)).toLocaleString()} |`);
  }
  lines.push('', verdict(r), '');
  // Example instance with raw costs.
  const ex = r.example;
  lines.push(`<details><summary>Example instance (seed ${ex.seed}): cost mean ± std over ${RUNS} runs</summary>`, '');
  lines.push(`Reference cost: ${ex.reference.cost.toFixed(2)} (${ex.reference.kind === 'exact' ? 'exact optimum' : 'best found'}).`, '');
  lines.push('| Algorithm | Cost, mean ± std | Median | Best | Gap of mean | Feasible runs |', '|---|---:|---:|---:|---:|---:|');
  for (const [a, s] of Object.entries(ex.summary).sort((p, q) => p[1].mean - q[1].mean)) {
    lines.push(`| ${LABEL[a] || a} | ${s.mean.toFixed(2)} ± ${s.std.toFixed(2)} | ${s.median.toFixed(2)} | ${s.best.toFixed(2)} | ${pct(s.gapPct)} | ${s.feasibleRuns}/${s.runs} |`);
  }
  lines.push('', '</details>');
  return lines.join('\n');
}

// Plain-language outcome computed from the numbers (no hand-written claims).
function verdict(r) {
  const meta = Object.keys(r.agg).filter((a) => a !== 'CW' && a !== 'QPSO-core' && a !== 'QPSO-greedy');
  const byGap = meta.slice().sort((a, b) => avg(r.agg[a].gap) - avg(r.agg[b].gap));
  const byWins = meta.slice().sort((a, b) => r.agg[b].wins - r.agg[a].wins);
  const q = r.agg.QPSO, top = byGap[0], cw = r.agg.CW;
  const parts = [];
  parts.push(`**Outcome:** lowest mean gap among the metaheuristics: **${top}** (${pct(avg(r.agg[top].gap))})` +
    (top === 'QPSO' ? '' : `; QPSO ${pct(avg(q.gap))}`) + '.');
  const w = byWins.filter((a) => r.agg[a].wins === r.agg[byWins[0]].wins);
  parts.push(`Most instance wins (lowest mean cost): ${w.join(' and ')} (${r.agg[byWins[0]].wins}/${r.instances})` +
    (w.includes('QPSO') ? '' : `; QPSO ${q.wins}/${r.instances}`) + '.');
  // Paired comparison on the same instances: QPSO vs the best other metaheuristic.
  const rival = byGap.find((a) => a !== 'QPSO');
  const d = q.gap.map((x, i) => x - r.agg[rival].gap[i]);
  const se = sd(d) / Math.sqrt(d.length);
  const md = avg(d);
  const qLower = d.filter((x) => x < 0).length;
  // With fewer than 6 instances no paired test can reach significance, so don't make a call.
  const call = d.length < 6 ? `only ${d.length} instances, too few for a significance call`
    : Math.abs(md) <= 2 * se ? 'within run-to-run and instance noise (|difference| <= 2 SE)'
    : md < 0 ? 'QPSO clearly lower (> 2 SE)' : `${rival} clearly lower (> 2 SE)`;
  parts.push(`QPSO vs ${rival}, paired by instance: QPSO lower on ${qLower}/${d.length}; mean gap difference ${md >= 0 ? '+' : ''}${md.toFixed(1)} points (SE ${se.toFixed(1)}), ${call}.`);
  if (cw) parts.push(`Clarke-Wright is at or below every metaheuristic's mean on ${cw.wins}/${r.instances} instances (median gap ${pct(med(cw.gap))}).`);
  return parts.join(' ');
}

const plan = quick
  ? [[8, 3, 1], [20, 3, 1]]
  : [[8, 10, 1], [20, 10, 1], [50, 5, 1], [20, 10, 0.5], [20, 10, 2]];

// The saved report (docs/results.md, README block) contains only seeded, reproducible
// numbers so a clean clone regenerates it byte-for-byte; wall-clock times are machine-
// dependent and are printed to the console only.
const header = (withTimes) => [
  `# Q-FLOW algorithm comparison (${tuning ? 'tuning' : 'held-out'} instances, seeds ${seedBase}..)`,
  '',
  `Generated by \`npm run bench\` (scripts/compare-algorithms.js). Engine fingerprint \`${ENGINE_HASH}\`.` + (withTimes ? ` Node ${process.version}.` : ''),
  withTimes
    ? 'Every instance and run is seeded, so the cost columns are reproducible; times depend on the machine.'
    : 'Every instance and run is seeded, so every number here is reproducible. Run times are machine-dependent and are printed by npm run bench, not saved.',
  'All metaheuristics get the same objective-evaluation budget and ' + RUNS + ' independent seeded runs per instance.',
  'Gap = (cost - reference) / reference. "Gap, mean ± std" pools all runs on all instances. "Wins" counts instances where the',
  "algorithm had the lowest mean cost among the metaheuristics (for Clarke-Wright: at or below the best metaheuristic mean).",
  'Clarke-Wright runs once per instance, so its ± is the spread across instances. "Best-run gap" averages, over instances,',
  "each algorithm's best of its runs. Mean gaps at n >= 20 are dominated by a few instances with heavy penalties; see the median.",
  '"Feasible runs" = share of runs whose plan has no capacity overload, no lateness (including returning after the depot closes) and no extra vehicles.',
  'QPSO settings were tuned on seeds 101-110, not on these instances. Method and discussion: BENCHMARK.md.',
  ''
];
const out = header(true), saved = header(false);
for (const [n, inst, scale] of plan) {
  const r = study(n, inst, scale);
  for (const [arr, t] of [[out, true], [saved, false]]) {
    if (scale !== 1) arr.push(`#### Budget sensitivity: ${scale}x default budget`);
    arr.push(table(r, t), '');
  }
}
console.log(out.join('\n'));
const report = saved.join('\n');
if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, report + '\n');
  process.stderr.write(`Saved ${outFile}\n`);
}
if (readmeFile) {
  // README gets the three main tables (default budget), not the sensitivity runs.
  const main = report.split('#### Budget sensitivity')[0].split('\n### ').slice(1).map((t) => '#### ' + t.trim()).join('\n\n');
  const block = `<!-- results:start -->\n<!-- Generated by npm run bench; edit scripts/compare-algorithms.js, not this block. -->\n${main}\n\nFull report with budget-sensitivity runs: [docs/results.md](docs/results.md).\n<!-- results:end -->`;
  const md = fs.readFileSync(readmeFile, 'utf8');
  if (!/<!-- results:start -->[\s\S]*<!-- results:end -->/.test(md)) { console.error(`No results markers in ${readmeFile}`); process.exit(1); }
  fs.writeFileSync(readmeFile, md.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, () => block));
  process.stderr.write(`Updated results block in ${readmeFile}\n`);
}
