// Shared property-based checks for the VRP tests (no exact-number assertions).
const assert = require('assert');

// Drop wall-clock fields so two runs can be compared for identical output.
const TIMING_KEYS = new Set(['executionTimeMs', 'timeMs', 'ms', 'meanTimeMs']);
function stripTiming(x) {
  if (Array.isArray(x)) return x.map(stripTiming);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) if (!TIMING_KEYS.has(k)) o[k] = stripTiming(x[k]);
    return o;
  }
  return x;
}
function assertSameOutput(a, b, label) {
  assert.deepStrictEqual(stripTiming(a), stripTiming(b), `${label}: same seed must give identical output`);
}

// Independently re-walks a solution's routes and checks it against the model:
// every customer exactly once, fleet size respected, no capacity overload, and
// the reported capacity / lateness figures match a from-scratch recount.
// Clarke-Wright builds its own routes and may need more vehicles than the fleet
// has; that is allowed only if the excess is reported (r.fleetExcess).
function assertValidSolution(r, nodes, matrix, cap, veh) {
  const label = r.algorithm;
  const n = nodes.length - 1;
  assert.ok(Array.isArray(r.routes) && r.routes.length > 0, `${label}: no routes`);
  if (r.fleetExcess !== undefined) {
    assert.strictEqual(r.fleetExcess, Math.max(0, r.routes.length - veh), `${label}: fleet excess mis-reported`);
  } else {
    assert.ok(r.routes.length <= veh, `${label}: uses ${r.routes.length} routes for ${veh} vehicles`);
  }

  const seen = new Array(n + 1).fill(0);
  let capOver = 0, late = 0, dist = 0;
  for (const route of r.routes) {
    let load = 0, t = 0, prev = 0;
    for (const c of route.customers) {
      assert.ok(Number.isInteger(c) && c >= 1 && c <= n, `${label}: bad customer id ${c}`);
      seen[c]++;
      load += nodes[c].demand;
      dist += matrix.dist[prev][c];
      t += matrix.time[prev][c];
      late += Math.max(0, t - (nodes[c].dueTime ?? Infinity));
      t = Math.max(t, nodes[c].readyTime || 0) + (nodes[c].serviceTime || 5);
      prev = c;
    }
    dist += matrix.dist[prev][0];
    // Returning after the depot closes is lateness too.
    late += Math.max(0, t + matrix.time[prev][0] - (nodes[0].dueTime ?? Infinity));
    assert.strictEqual(route.load, load, `${label}: route load mismatch`);
    capOver += Math.max(0, load - cap);
  }
  for (let c = 1; c <= n; c++) assert.strictEqual(seen[c], 1, `${label}: customer ${c} visited ${seen[c]}x`);

  assert.strictEqual(capOver, 0, `${label}: capacity exceeded by ${capOver}`);
  assert.strictEqual(r.capViolations, capOver, `${label}: capViolations under-reported`);
  assert.ok(Math.abs(r.timeViolations - late) < 0.11, `${label}: timeViolations ${r.timeViolations} vs recount ${late.toFixed(1)}`);
  assert.ok(Math.abs(r.totalDistKm - dist) < 0.011, `${label}: totalDistKm ${r.totalDistKm} vs recount ${dist.toFixed(2)}`);
  // The feasibility flag must agree with the recount.
  if (r.feasible !== undefined) {
    const expect = capOver === 0 && late < 0.05 && (r.fleetExcess || r.violations.extraVehicles || 0) === 0;
    assert.strictEqual(r.feasible, expect, `${label}: feasible flag (${r.feasible}) disagrees with the recount`);
  }
}

function assertSeedRecorded(r, label) {
  assert.ok(Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 0xffffffff, `${label}: missing/invalid seed (${r.seed})`);
}

module.exports = { assert, stripTiming, assertSameOutput, assertValidSolution, assertSeedRecorded };
