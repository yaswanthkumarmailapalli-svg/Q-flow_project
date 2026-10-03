/* =====================================================================
   Q-FLOW QUANTUM-INSPIRED & METAHEURISTIC VRP ENGINE (CVRPTW)
   All algorithms are classical code; nothing here needs quantum hardware.
   =====================================================================
   - Quantum-inspired QPSO (Quantum-Behaved Particle Swarm Optimization)
     (Sun, Feng & Xu 2004 delta-potential-well update; memetic variant with
      heuristic seeding + Lamarckian 2-opt/or-opt local search)
   - Classical Metaheuristics for Benchmarking:
     * Genetic Algorithm (GA) with OX Crossover & 2-Opt Mutation
     * Ant Colony Optimization (ACO) with Pheromone Matrices
     * Simulated Annealing (SA) with Boltzmann Acceptance
     * Clarke-Wright Savings (greedy constructive heuristic, time-window-aware)
   - Exact enumeration for small instances (<= 9 customers)
   - Equal-evaluation-budget, multi-run seeded benchmark (mean/std/gap)
   - Dynamic Bureau of Public Roads (BPR) Traffic Congestion Formulation
   - Capacitated Vehicle Routing Problem with Time Windows (CVRPTW)
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./emissions.js'));
  } else {
    root.QFlowVRP = factory(root.QFlowEmissions);
  }
})(typeof self !== 'undefined' ? self : this, function (Emissions) {
  'use strict';

  // --- Utility Functions ---
  function euclideanDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function haversineDistKm(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // --- Seeded, reproducible randomness ---
  // mulberry32: tiny 32-bit PRNG, uniform floats in [0, 1). Same seed -> same stream.
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Normalise any seed (number or string) to an unsigned 32-bit integer.
  function normalizeSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    const s = String(seed);
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  // Fresh seed when the caller does not supply one (keeps UI runs varied).
  // This is the only place entropy enters the engine; everything else flows from the seed.
  function randomSeed() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
    return (Math.random() * 4294967296) >>> 0;
  }

  // makeRng(seed) -> function returning floats in [0, 1); the normalised seed is exposed as rng.seed.
  function makeRng(seed) {
    const s = seed === undefined || seed === null ? randomSeed() : normalizeSeed(seed);
    const rng = mulberry32(s);
    rng.seed = s;
    return rng;
  }

  // Deterministically derive the k-th child seed from a parent seed.
  function deriveSeed(seed, k) {
    return (mulberry32((normalizeSeed(seed) + Math.imul(k + 1, 0x9e3779b9)) >>> 0)() * 4294967296) >>> 0;
  }

  // Pick the rng for a run: config.rng (injected function) > config.seed > fresh random seed.
  // Returns { rng, seed }; seed is null only if an injected rng carries no .seed.
  function resolveRng(config = {}) {
    if (config && typeof config.rng === 'function') {
      const seed = config.rng.seed !== undefined ? config.rng.seed : config.seed !== undefined ? config.seed : null;
      return { rng: config.rng, seed };
    }
    const rng = makeRng(config ? config.seed : undefined);
    return { rng, seed: rng.seed };
  }

  // For composite runs: resolve one numeric base seed (drawn from an injected rng if needed).
  function resolveSeed(config = {}) {
    if (config && config.seed !== undefined && config.seed !== null) return normalizeSeed(config.seed);
    if (config && typeof config.rng === 'function') return (config.rng() * 4294967296) >>> 0;
    return randomSeed();
  }

  function shuffle(array, rng) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Bureau of Public Roads (BPR) Congestion Model ---
  // t_ij = t0_ij * (1 + alpha * (V/C)^beta) + incidentDelay
  function computeCongestedTime(freeFlowDistKm, speedKmH, volumeRatio, incidentMin = 0) {
    const t0Min = (freeFlowDistKm / Math.max(10, speedKmH)) * 60;
    const alphaBPR = 0.15;
    const betaBPR = 4.0;
    const congestionFactor = 1 + alphaBPR * Math.pow(Math.max(0, volumeRatio), betaBPR);
    return t0Min * congestionFactor + incidentMin;
  }

  // --- Distance & Travel Time Matrix Generator ---
  // --- Input validation ---
  // Structured error for invalid problem input; the UI shows .message, and
  // .code / .field identify the problem for callers and tests.
  class QFlowInputError extends Error {
    constructor(code, message, field) {
      super(message);
      this.name = 'QFlowInputError';
      this.code = code;
      this.field = field;
    }
  }

  // Upper bound on customers per optimisation run: keeps one request from
  // freezing the page (ACO is O(n^2) per tour). Callers can raise it explicitly.
  const MAX_CUSTOMERS = 200;

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Throws QFlowInputError for input that would make costs meaningless.
  function validateInstance(nodes, vehicleCapacity, numVehicles, opts = {}) {
    if (!Array.isArray(nodes) || nodes.length < 1) throw new QFlowInputError('no-depot', 'The instance needs at least a depot (node 0).', 'nodes');
    const maxCustomers = opts.maxCustomers || MAX_CUSTOMERS;
    if (nodes.length - 1 > maxCustomers) {
      throw new QFlowInputError('too-many-stops', `Too many delivery stops (${nodes.length - 1}); the limit is ${maxCustomers} per run.`, 'nodes');
    }
    nodes.forEach((n, i) => {
      if (!n || typeof n !== 'object') throw new QFlowInputError('bad-node', `Stop ${i} is not an object.`, `nodes[${i}]`);
      const hasGeo = isNum(n.lat) && isNum(n.lng);
      const hasXY = isNum(n.x) && isNum(n.y);
      if (!hasGeo && !hasXY) throw new QFlowInputError('bad-location', `Stop ${i} has no valid coordinates.`, `nodes[${i}]`);
      if (hasGeo && (Math.abs(n.lat) > 90 || Math.abs(n.lng) > 180)) throw new QFlowInputError('bad-location', `Stop ${i} has coordinates outside the valid range.`, `nodes[${i}]`);
      const demand = n.demand === undefined && i === 0 ? 0 : n.demand;
      if (!isNum(demand) || demand < 0) throw new QFlowInputError('bad-demand', `Stop ${i} has an invalid demand (${n.demand}).`, `nodes[${i}].demand`);
      for (const k of ['readyTime', 'dueTime', 'serviceTime']) {
        if (n[k] !== undefined && (!isNum(n[k]) || n[k] < 0)) throw new QFlowInputError('bad-time', `Stop ${i} has an invalid ${k} (${n[k]}).`, `nodes[${i}].${k}`);
      }
      if (isNum(n.readyTime) && isNum(n.dueTime) && n.dueTime < n.readyTime) {
        throw new QFlowInputError('bad-time', `Stop ${i}: the time window closes before it opens.`, `nodes[${i}]`);
      }
    });
    if (!isNum(vehicleCapacity) || vehicleCapacity <= 0) throw new QFlowInputError('bad-capacity', 'Vehicle capacity must be a positive number.', 'vehicleCapacity');
    if (!Number.isInteger(numVehicles) || numVehicles < 1) throw new QFlowInputError('bad-fleet', 'The fleet needs at least one vehicle.', 'numVehicles');
    return true;
  }

  // Non-throwing checks that explain why no feasible plan may exist.
  function instanceDiagnostics(nodes, vehicleCapacity, numVehicles) {
    const out = [];
    const customers = nodes.slice(1);
    const total = customers.reduce((s, n) => s + (n.demand || 0), 0);
    if (total > vehicleCapacity * numVehicles) {
      out.push({ code: 'fleet-too-small', message: `Total demand ${total} kg exceeds the fleet's capacity (${numVehicles} × ${vehicleCapacity} kg); no plan can avoid overloading.` });
    }
    customers.forEach((n, k) => {
      if ((n.demand || 0) > vehicleCapacity) out.push({ code: 'stop-too-heavy', message: `Stop ${k + 1} needs ${n.demand} kg but each vehicle carries ${vehicleCapacity} kg.` });
    });
    return out;
  }

  // --- Simulated traffic profile (NOT live data) ---
  // V/C multiplier by time of day: low overnight, peaks around 09:00 and 18:30.
  // An illustrative urban shape, not measured from any city.
  function trafficProfile(minuteOfDay) {
    const t = ((minuteOfDay % 1440) + 1440) % 1440;
    const peak = (mu, sd, h) => h * Math.exp(-(((t - mu) / sd) ** 2));
    return 0.55 + peak(540, 75, 0.6) + peak(1110, 90, 0.7);
  }

  // Deterministic per-road-segment value in [0, 1), symmetric in (i, j).
  function segmentNoise(i, j, seed) {
    const a = Math.min(i, j), b = Math.max(i, j);
    let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77) ^ normalizeSeed(seed || 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const MAX_VC = 3; // effective V/C is clamped to [0, 3] (BPR factor at most ~13x)

  // trafficLevel: network-wide V/C. opts (all optional, simulated traffic only):
  //   timeOfDayMin  - minute of day; scales V/C by trafficProfile()
  //   segmentVariation - 0..1, per-road spread around the network value (default 0)
  //   seed          - makes the per-road pattern reproducible
  // Without opts the matrix is identical to the original uniform model.
  function buildCostMatrix(nodes, trafficLevel = 1.0, incidentMatrix = null, opts = {}) {
    if (!Array.isArray(nodes)) throw new QFlowInputError('bad-nodes', 'Nodes must be an array.', 'nodes');
    if (!isNum(trafficLevel) || trafficLevel < 0) throw new QFlowInputError('bad-traffic', `Traffic level must be a number ≥ 0 (got ${trafficLevel}).`, 'trafficLevel');
    const variation = opts.segmentVariation === undefined ? 0 : opts.segmentVariation;
    if (!isNum(variation) || variation < 0 || variation > 1) throw new QFlowInputError('bad-traffic', 'Segment variation must be between 0 and 1.', 'segmentVariation');
    const useTime = opts.timeOfDayMin !== undefined && opts.timeOfDayMin !== null;
    if (useTime && !isNum(opts.timeOfDayMin)) throw new QFlowInputError('bad-traffic', 'Time of day must be a number of minutes.', 'timeOfDayMin');
    const timeFactor = useTime ? trafficProfile(opts.timeOfDayMin) : 1;
    const n = nodes.length;
    const dist = [];
    const time = [];
    const avgSpeed = 40; // km/h base urban speed

    for (let i = 0; i < n; i++) {
      dist[i] = new Float64Array(n);
      time[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        if (i === j) {
          dist[i][j] = 0;
          time[i][j] = 0;
        } else {
          let d = 0;
          if (nodes[i].lat !== undefined && nodes[j].lat !== undefined) {
            d = haversineDistKm(nodes[i], nodes[j]);
          } else {
            d = euclideanDist(nodes[i], nodes[j]);
          }
          // Road detour factor (Manhattan/curving roads ~ 1.28)
          d = d * 1.28;
          dist[i][j] = d;

          let inc = incidentMatrix && incidentMatrix[i] ? incidentMatrix[i][j] || 0 : 0;
          if (!isNum(inc) || inc < 0) inc = 0;
          let vc = trafficLevel * timeFactor;
          if (variation > 0) vc *= 1 + variation * (2 * segmentNoise(i, j, opts.seed) - 1);
          vc = Math.min(MAX_VC, Math.max(0, vc));
          time[i][j] = computeCongestedTime(d, avgSpeed, vc, inc);
        }
      }
    }
    // Describes how this matrix was made, so the UI can label it honestly.
    const traffic = {
      source: 'simulated',
      network: 'straight-line distance x 1.28 detour factor (no road network)',
      trafficLevel,
      timeOfDayMin: useTime ? opts.timeOfDayMin : null,
      timeFactor: parseFloat(timeFactor.toFixed(3)),
      segmentVariation: variation,
      seed: opts.seed === undefined ? null : opts.seed,
      incidents: !!incidentMatrix
    };
    return { dist, time, traffic };
  }

  // --- CVRPTW Tour Evaluator & Splitter ---
  // Evaluates a sequence of customer indices (1 .. N) and splits into routes according to capacity and time windows
  function evaluateTourSequence(sequence, nodes, matrix, vehicleCapacity, numVehicles, opts = {}) {
    const penaltyCapWeight = opts.penaltyCap || 1500;
    const penaltyTimeWeight = opts.penaltyTime || 20;
    const { dist, time } = matrix;

    let routes = [];
    let currentRoute = [];
    let currentLoad = 0;
    let currentTime = 0;
    let totalDist = 0;
    let totalTime = 0;
    let totalCapViolations = 0;
    let totalTimeViolations = 0;
    let totalWaitTime = 0;
    let routeDist = 0; // driving distance / time of the current route (for the emissions estimate)
    let routeDrive = 0;

    let prevNode = 0; // Depot
    // Vehicles must be back before the depot closes; arriving later counts as lateness.
    const depotDue = nodes[0] && isNum(nodes[0].dueTime) ? nodes[0].dueTime : Infinity;

    for (let i = 0; i < sequence.length; i++) {
      const custId = sequence[i];
      const cust = nodes[custId];
      const travelDist = dist[prevNode][custId];
      const travelTime = time[prevNode][custId];
      const arrival = currentTime + travelTime;

      // Check capacity
      const exceedsCap = currentLoad + cust.demand > vehicleCapacity;
      // Soft / hard threshold check to start a new vehicle route
      const exceedsVehicles = routes.length >= numVehicles - 1;

      if (exceedsCap && !exceedsVehicles && currentRoute.length > 0) {
        // Return current vehicle to depot
        const returnDist = dist[prevNode][0];
        const returnTime = time[prevNode][0];
        totalDist += returnDist;
        totalTime += currentTime + returnTime;
        totalTimeViolations += Math.max(0, currentTime + returnTime - depotDue);
        // A single stop heavier than a vehicle overloads its route wherever it sits.
        totalCapViolations += Math.max(0, currentLoad - vehicleCapacity);

        routes.push({
          customers: currentRoute,
          load: currentLoad,
          capacity: vehicleCapacity,
          finishTime: currentTime + returnTime,
          distKm: routeDist + returnDist,
          driveTimeMin: routeDrive + returnTime
        });

        // Start new vehicle
        currentRoute = [];
        currentLoad = 0;
        currentTime = 0;
        routeDist = 0;
        routeDrive = 0;
        prevNode = 0;
      }

      // Add to current route
      currentRoute.push(custId);
      currentLoad += cust.demand;
      const legDist = dist[prevNode][custId];
      const legTravelTime = time[prevNode][custId];
      totalDist += legDist;
      routeDist += legDist;
      routeDrive += legTravelTime;

      const arrivalTime = currentTime + legTravelTime;
      const waitTime = Math.max(0, (cust.readyTime || 0) - arrivalTime);
      const serviceStart = arrivalTime + waitTime;
      const lateTime = Math.max(0, arrivalTime - (cust.dueTime || Infinity));

      totalWaitTime += waitTime;
      totalTimeViolations += lateTime;
      currentTime = serviceStart + (cust.serviceTime || 5);
      prevNode = custId;
    }

    // Close last route
    if (currentRoute.length > 0) {
      const returnDist = dist[prevNode][0];
      const returnTime = time[prevNode][0];
      totalDist += returnDist;
      totalTime += currentTime + returnTime;
      totalTimeViolations += Math.max(0, currentTime + returnTime - depotDue);
      if (currentLoad > vehicleCapacity) {
        totalCapViolations += currentLoad - vehicleCapacity;
      }
      routes.push({
        customers: currentRoute,
        load: currentLoad,
        capacity: vehicleCapacity,
        finishTime: currentTime + returnTime,
        distKm: routeDist + returnDist,
        driveTimeMin: routeDrive + returnTime
      });
    }

    // Penalize if routes count exceeds available vehicles
    const fleetExcess = Math.max(0, routes.length - numVehicles);
    const cost =
      totalDist * 1.0 +
      totalTime * 0.4 +
      totalCapViolations * penaltyCapWeight +
      totalTimeViolations * penaltyTimeWeight +
      fleetExcess * 10000;

    return {
      cost,
      totalDist: parseFloat(totalDist.toFixed(2)),
      totalTime: parseFloat(totalTime.toFixed(1)),
      routes,
      totalCapViolations,
      totalTimeViolations: parseFloat(totalTimeViolations.toFixed(1)),
      totalWaitTime: parseFloat(totalWaitTime.toFixed(1)),
      fleetExcess
    };
  }

  // --- Random Keys <-> Tour ---
  function decodeRandomKeys(keys) {
    // keys is an array of continuous floats [x1, x2, ..., xN]
    // Sorting indices gives customer permutation 1..N
    return keys
      .map((val, idx) => ({ idx: idx + 1, val }))
      .sort((a, b) => a.val - b.val)
      .map((item) => item.idx);
  }

  // Encode a customer permutation as random keys: customer at rank r gets a key
  // inside bucket [r/n, (r+1)/n), so decodeRandomKeys(encode(seq)) === seq.
  function encodeRandomKeys(seq, rng) {
    const n = seq.length;
    const keys = new Float64Array(n);
    for (let r = 0; r < n; r++) keys[seq[r] - 1] = (r + 0.1 + 0.8 * rng()) / n;
    return keys;
  }

  // Lamarckian write-back: re-order the particle's own key values so the
  // position decodes to `seq` while keeping its spread of values. Falls back
  // to bucket encoding if clamping left duplicate keys (ties would mis-decode).
  function writeBackKeys(position, seq, rng) {
    const sorted = Array.from(position).sort((a, b) => a - b);
    for (let r = 1; r < sorted.length; r++) {
      if (!(sorted[r] > sorted[r - 1])) {
        position.set(encodeRandomKeys(seq, rng));
        return;
      }
    }
    for (let r = 0; r < seq.length; r++) position[seq[r] - 1] = sorted[r];
  }

  // --- Evaluation budget ---
  // Every solver counts calls to evaluateTourSequence (the objective). With
  // config.maxEvaluations set, iteration limits are ignored and each solver's
  // schedule (alpha, temperature, inertia) is driven by the fraction of the
  // budget used, so all algorithms get exactly the same number of evaluations.
  // --- Optimal split decoder (Prins 2004 style) ---
  // Given a customer order, chooses where to start new vehicles so that the total
  // objective (the same terms as evaluateTourSequence, per route) is minimal, using
  // at most numVehicles routes. Dynamic programming over (routes used, customers served):
  // a route may grow while its load fits the capacity; one stop heavier than a vehicle
  // may form its own (overloaded) route; and the last allowed vehicle may take the whole
  // remainder (overloaded if it must). The greedy decoder is one feasible choice of
  // these breaks, so this decoder is never worse for the same order.
  function splitTourSequence(sequence, nodes, matrix, vehicleCapacity, numVehicles, opts = {}) {
    const n = sequence.length;
    if (!n) return evaluateRoutes([], nodes, matrix, vehicleCapacity, numVehicles, opts);
    const capW = opts.penaltyCap || 1500, timeW = opts.penaltyTime || 20;
    const { dist, time } = matrix;
    const depotDue = nodes[0] && isNum(nodes[0].dueTime) ? nodes[0].dueTime : Infinity;
    const K = Math.max(1, Math.min(numVehicles, n));
    // f[k][j]: best cost serving the first j customers with exactly k routes.
    const f = [], from = [];
    for (let k = 0; k <= K; k++) { f.push(new Float64Array(n + 1).fill(Infinity)); from.push(new Int32Array(n + 1).fill(-1)); }
    f[0][0] = 0;
    for (let i = 0; i < n; i++) {
      // Is any route count able to start a route at position i?
      let any = false;
      for (let k = 0; k < K; k++) if (f[k][i] < Infinity) { any = true; break; }
      if (!any) continue;
      let t = 0, prev = 0, d = 0, late = 0, load = 0;
      for (let j = i; j < n; j++) {
        const c = sequence[j], cust = nodes[c];
        d += dist[prev][c];
        const arrival = t + time[prev][c];
        const w = Math.max(0, (cust.readyTime || 0) - arrival);
        late += Math.max(0, arrival - (cust.dueTime || Infinity));
        t = arrival + w + (cust.serviceTime || 5);
        load += cust.demand;
        prev = c;
        const over = Math.max(0, load - vehicleCapacity);
        const fits = over === 0 || j === i; // a single heavy stop may stand alone
        const toEnd = j === n - 1;
        if (!fits && !toEnd) continue;      // only the final route may run over capacity
        const finish = t + time[c][0];
        const cost = d + dist[c][0] + 0.4 * finish + capW * over + timeW * (late + Math.max(0, finish - depotDue));
        for (let k = 1; k <= K; k++) {
          const base = f[k - 1][i];
          if (base === Infinity) continue;
          const v = base + cost;
          if (v < f[k][j + 1]) { f[k][j + 1] = v; from[k][j + 1] = i; }
        }
      }
    }
    let bestK = -1;
    for (let k = 1; k <= K; k++) if (f[k][n] < Infinity && (bestK < 0 || f[k][n] < f[bestK][n])) bestK = k;
    if (bestK < 0) return evaluateTourSequence(sequence, nodes, matrix, vehicleCapacity, numVehicles, opts);
    const routes = [];
    for (let k = bestK, j = n; k > 0; k--) { const i = from[k][j]; routes.unshift(sequence.slice(i, j)); j = i; }
    return evaluateRoutes(routes, nodes, matrix, vehicleCapacity, numVehicles, opts);
  }

  function makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const budget = config && config.maxEvaluations > 0 ? Math.floor(config.maxEvaluations) : Infinity;
    let used = 0;
    return {
      budget,
      limited: Number.isFinite(budget),
      decoder: config && config.decoder === 'split' ? 'split' : 'greedy',
      eval(seq) {
        used++;
        return config && config.decoder === 'split'
          ? splitTourSequence(seq, nodes, matrix, vehicleCapacity, numVehicles)
          : evaluateTourSequence(seq, nodes, matrix, vehicleCapacity, numVehicles);
      },
      get used() {
        return used;
      },
      done() {
        return used >= budget;
      }
    };
  }

  // CO2 estimate for an evaluated solution: each route at its own average
  // driving speed (src/emissions.js). Falls back to the flat reference factor
  // (120 g/km) on total distance if per-route driving data is missing.
  function co2GramsOf(ev) {
    const routes = ev.routes || [];
    if (routes.length && routes.every((r) => r.distKm >= 0 && r.driveTimeMin >= 0)) {
      return Math.round(Emissions.routesGrams(routes));
    }
    return Math.round(ev.totalDist * Emissions.gPerKm(NaN));
  }

  // Shared result shape for every solver.
  // A plan is feasible when no vehicle is overloaded, nobody is served late
  // (including the return to the depot) and the fleet size is respected.
  function feasibilityOf(ev) {
    const violations = {
      capacityKg: ev.totalCapViolations || 0,
      lateMin: ev.totalTimeViolations || 0,
      extraVehicles: ev.fleetExcess || 0
    };
    return { feasible: violations.capacityKg === 0 && violations.lateMin === 0 && violations.extraVehicles === 0, violations };
  }

  function packResult(algorithm, type, seed, ev, convergence, convergenceEvals, E, startTime) {
    const f = feasibilityOf(ev);
    return {
      algorithm,
      type,
      seed,
      feasible: f.feasible,
      violations: f.violations,
      bestCost: parseFloat(ev.cost.toFixed(2)),
      totalDistKm: ev.totalDist,
      totalTimeMin: ev.totalTime,
      routes: ev.routes,
      capViolations: ev.totalCapViolations,
      timeViolations: ev.totalTimeViolations,
      waitTime: ev.totalWaitTime,
      convergence,
      convergenceEvals,
      evaluations: E.used,
      maxEvaluations: E.limited ? E.budget : null,
      executionTimeMs: parseFloat((performance.now() - startTime).toFixed(2)),
      co2Grams: co2GramsOf(ev)
    };
  }

  // --- Constructive heuristics (no objective evaluations needed) ---
  // Greedy nearest neighbour from the depot over a cost matrix (dist or time).
  function nearestNeighbourSequence(costRows, numCustomers) {
    const left = new Set(Array.from({ length: numCustomers }, (_, i) => i + 1));
    const seq = [];
    let cur = 0;
    while (left.size) {
      let best = -1;
      for (const c of left) if (best < 0 || costRows[cur][c] < costRows[cur][best]) best = c;
      seq.push(best);
      left.delete(best);
      cur = best;
    }
    return seq;
  }

  // Solomon (1987) time-oriented nearest neighbour: next customer minimises
  //   0.4 * distance + 0.4 * (service-start gap) + 0.2 * urgency (due - arrival),
  // starting a new vehicle at the depot (time 0) when capacity would be exceeded
  // (same split rule as evaluateTourSequence). Unlike plain NN/CW it respects time windows.
  function timeOrientedNNSequence(nodes, matrix, vehicleCapacity) {
    const n = nodes.length - 1;
    const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
    const seq = [];
    let cur = 0, t = 0, load = 0;
    while (left.size) {
      let best = -1, bestScore = Infinity;
      for (const c of left) {
        const node = nodes[c];
        const fromDepot = load + node.demand > vehicleCapacity;
        const from = fromDepot ? 0 : cur, t0 = fromDepot ? 0 : t;
        const arrive = t0 + matrix.time[from][c];
        const start = Math.max(arrive, node.readyTime || 0);
        const urgency = (node.dueTime ?? 1e6) - arrive;
        const late = Math.max(0, -urgency);
        const score = 0.4 * matrix.dist[from][c] + 0.4 * (start - t0) + 0.2 * Math.max(0, urgency) + 20 * late;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      const node = nodes[best];
      if (load + node.demand > vehicleCapacity) { cur = 0; t = 0; load = 0; }
      t = Math.max(t + matrix.time[cur][best], node.readyTime || 0) + (node.serviceTime || 5);
      load += node.demand;
      cur = best;
      seq.push(best);
      left.delete(best);
    }
    return seq;
  }

  // Earliest-due-date order (classic time-window priority rule).
  function earliestDueDateSequence(nodes) {
    return Array.from({ length: nodes.length - 1 }, (_, i) => i + 1).sort(
      (a, b) => (nodes[a].dueTime ?? 1e6) - (nodes[b].dueTime ?? 1e6) || a - b
    );
  }

  // Heuristic tours used to seed QPSO, by name.
  const SEED_HEURISTICS = {
    cw: (nodes, matrix, cap) => clarkeWrightSequence(nodes, matrix, cap),
    nn: (nodes, matrix) => nearestNeighbourSequence(matrix.dist, nodes.length - 1),
    'tw-nn': (nodes, matrix, cap) => timeOrientedNNSequence(nodes, matrix, cap),
    edd: (nodes) => earliestDueDateSequence(nodes)
  };

  // --- Local search: sampled 2-opt / or-opt moves ---
  // One random neighbour: 2-opt reverses s[i..j]; or-opt moves a 1-3 customer
  // segment to another position. Returns null for a no-op move.
  // withSwap: one third 2-opt, one third or-opt, one third swap of two customers
  // (the swap exchanges stops between routes, which helps pack capacity-tight fleets).
  function sampleMove(seq, rng, withSwap) {
    const n = seq.length;
    const s = seq.slice();
    if (withSwap && rng() < 1 / 3) {
      const i = Math.floor(rng() * n), j = Math.floor(rng() * n);
      if (i === j) return null;
      [s[i], s[j]] = [s[j], s[i]];
      return s;
    }
    if (rng() < 0.5) {
      let i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (i > j) [i, j] = [j, i];
      if (j - i < 1) return null;
      while (i < j) {
        [s[i], s[j]] = [s[j], s[i]];
        i++;
        j--;
      }
      return s;
    }
    const L = 1 + Math.floor(rng() * Math.min(3, n - 1));
    const i = Math.floor(rng() * (n - L + 1));
    const seg = s.splice(i, L);
    const j = Math.floor(rng() * (s.length + 1));
    if (j === i) return null;
    s.splice(j, 0, ...seg);
    return s;
  }

  // Bounded hill climb: at most maxEvals evaluations, keeps strict improvements.
  function localSearch(seq, ev, E, rng, maxEvals, withSwap) {
    let bestSeq = seq;
    let bestEv = ev;
    if (seq.length < 3) return { seq: bestSeq, ev: bestEv };
    for (let k = 0, spent = 0; spent < maxEvals && k < maxEvals * 4 && !E.done(); k++) {
      const cand = sampleMove(bestSeq, rng, withSwap);
      if (!cand) continue;
      spent++;
      const e = E.eval(cand);
      if (e.cost < bestEv.cost - 1e-9) {
        bestSeq = cand;
        bestEv = e;
      }
    }
    return { seq: bestSeq, ev: bestEv };
  }

  // =================================================================
  // 1. QUANTUM-INSPIRED QPSO (Quantum-Behaved PSO), memetic variant.
  //    A classical metaheuristic: the "quantum" refers to the update rule's
  //    inspiration (delta potential well), not to quantum hardware.
  // Sun, Feng, & Xu (2004) Delta Potential Well Wave Function Model
  // =================================================================
  // The position update is the unmodified Sun/Feng/Xu rule:
  //   p   = phi * pBest + (1 - phi) * gBest,             phi ~ U(0,1)
  //   x'  = p +/- alpha * |mBest - x| * ln(1/u),          u ~ U(0,1)
  // Additions around it (none of them touch the update itself):
  //   * Heuristic seeding: 15% of the initial swarm is built from constructive
  //     tours (Clarke-Wright, nearest neighbour, Solomon time-oriented NN,
  //     earliest-due-date), encoded back into random keys. CW and plain NN
  //     ignore time windows and alone barely help; the time-window-aware
  //     tours are what make seeding pay off on 20+ customer instances.
  //   * Particle local search: with probability 0.25 a decoded tour gets a
  //     sampled 2-opt / or-opt hill climb of up to 2n evaluations.
  //   * Elite local search: once per iteration, up to 10n evaluations of the
  //     same hill climb on the global-best tour (moves: 2-opt, or-opt, swap).
  //   * Optimal split decoder: each customer order is cut into at most K routes
  //     at the cheapest break points (splitTourSequence), not greedily.
  //   Both local searches are Lamarckian (improved order written back into
  //   the position). Baldwinian (improved cost used as fitness only) is
  //   available via config.localSearch = 'baldwinian'; it was worse in the
  //   tuning runs (scripts/compare-algorithms.js, tuning seeds 101-110).
  // All local-search evaluations count against the same budget as everything else.
  //
  // Alpha (contraction-expansion coefficient) schedule:
  //   alpha decreases linearly from 0.95 to 0.50 over the run (by fraction of
  //   the evaluation budget when one is set, otherwise by iteration).
  //   The commonly cited convergence condition for mBest-based QPSO needs
  //   alpha below ~0.97; above it |mBest - x| can grow and the swarm diverges.
  //   The previous 1.0 start sat above that bound. 0.95 -> 0.50 is the usual
  //   1.0 -> 0.5 schedule moved inside the stable range. In tuning, ranges
  //   0.6-0.3, 0.8-0.4, 0.95-0.5 and 0.96-0.7 were within noise of each other.
  //   User overrides are clamped to <= 0.96.
  const QPSO_ALPHA_STABLE_MAX = 0.96;
  const QPSO_DEFAULTS = {
    // Routes from each particle's customer order are cut by the optimal split decoder
    // (splitTourSequence), chosen on the tuning seeds 101-110 (QPSO had the lowest mean
    // cost on 19 of 20 instances; SA gained little from it). 'greedy' = original decoder.
    decoder: 'split',
    // Swap move + longer elite search: chosen on a separate capacity-tight tuning set
    // (n = 50, seeds 204/205/208-211, 95-100% fleet use): lowest mean cost on 5 of 6 vs SA;
    // also never worse on seeds 101-110. Held-out seeds 1-10 were not used for tuning.
    lsSwap: true,
    alphaMax: 0.95,
    alphaMin: 0.5,
    swarmSize: 20,
    localSearch: 'lamarckian', // 'lamarckian' | 'baldwinian' | 'none'
    lsProbability: 0.25,
    lsEvalsPerCustomer: 2, // particle local-search cap = 2n evaluations
    eliteLsEvalsPerCustomer: 10, // elite local-search cap = 10n evaluations
    heuristicSeedFraction: 0.15,
    seedHeuristics: ['cw', 'nn', 'tw-nn', 'edd']
  };

  function runQPSO(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const { rng, seed } = resolveRng(config);
    const E = makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, Object.assign({ decoder: QPSO_DEFAULTS.decoder }, config));
    const numCustomers = nodes.length - 1;
    const swarmSize = config.swarmSize || QPSO_DEFAULTS.swarmSize;
    const maxIterations = E.limited ? Infinity : config.maxIterations || 100;
    const alphaMax = Math.min(config.alphaMax ?? QPSO_DEFAULTS.alphaMax, QPSO_ALPHA_STABLE_MAX);
    const alphaMin = Math.min(config.alphaMin ?? QPSO_DEFAULTS.alphaMin, alphaMax);
    const lsMode = config.localSearch ?? QPSO_DEFAULTS.localSearch; // 'lamarckian' | 'baldwinian' | 'none'
    const lsEvals = lsMode === 'none' ? 0 : config.lsMaxEvals ?? QPSO_DEFAULTS.lsEvalsPerCustomer * numCustomers;
    const seedFrac = config.heuristicSeedFraction ?? QPSO_DEFAULTS.heuristicSeedFraction;
    const eliteLsEvals = lsMode === 'none' ? 0 : config.eliteLsEvals ?? QPSO_DEFAULTS.eliteLsEvalsPerCustomer * numCustomers;
    const lsProb = config.lsProbability ?? QPSO_DEFAULTS.lsProbability; // chance a particle gets local search
    const lsSwap = config.lsSwap ?? QPSO_DEFAULTS.lsSwap; // add the swap move to the local search
    const progress = (iter) => (E.limited ? E.used / E.budget : iter / maxIterations);

    // Decode, evaluate and (optionally) improve one particle position.
    function assess(pos) {
      let seq = decodeRandomKeys(Array.from(pos));
      let ev = E.eval(seq);
      if (lsEvals > 0 && (lsProb >= 1 || rng() < lsProb)) {
        const r = localSearch(seq, ev, E, rng, lsEvals, lsSwap);
        if (r.ev.cost < ev.cost) {
          if (lsMode === 'lamarckian') writeBackKeys(pos, r.seq, rng);
          ev = r.ev;
        }
      }
      return ev;
    }

    // Heuristic seeds (distinct tours only), then perturbed copies to fill the quota.
    const nSeeded = seedFrac > 0 ? Math.min(swarmSize, Math.max(1, Math.round(seedFrac * swarmSize))) : 0;
    const heuristicTours = [];
    for (const name of config.seedHeuristics ?? QPSO_DEFAULTS.seedHeuristics) {
      const tour = SEED_HEURISTICS[name](nodes, matrix, vehicleCapacity);
      if (!heuristicTours.some((t) => t.join() === tour.join())) heuristicTours.push(tour);
    }

    const particles = [];
    let gBestPosition = new Float64Array(numCustomers);
    let gBestCost = Infinity;
    let gBestEvaluation = null;
    const convergenceHistory = [];
    const convergenceEvals = [];

    // Warm start: valid previous plans (customer orders) take the first particles,
    // so re-planning never returns something worse than the plan it replaces.
    const isPerm = (t) => Array.isArray(t) && t.length === numCustomers && new Set(t).size === numCustomers && t.every((c) => Number.isInteger(c) && c >= 1 && c <= numCustomers);
    const warm = (config.initialTours || []).filter(isPerm).slice(0, swarmSize);

    for (let p = 0; p < swarmSize && !E.done(); p++) {
      let pos;
      const h = p - warm.length;
      if (p < warm.length) {
        pos = encodeRandomKeys(warm[p], rng);
      } else if (h < nSeeded) {
        let tour = heuristicTours[h % heuristicTours.length];
        if (h >= heuristicTours.length) tour = sampleMove(tour, rng) || tour;
        pos = encodeRandomKeys(tour, rng);
      } else {
        pos = new Float64Array(numCustomers);
        for (let d = 0; d < numCustomers; d++) pos[d] = rng();
      }
      const evalRes = assess(pos);
      particles.push({ position: pos, pBestPosition: new Float64Array(pos), pBestCost: evalRes.cost });
      if (evalRes.cost < gBestCost) {
        gBestCost = evalRes.cost;
        gBestPosition.set(pos);
        gBestEvaluation = evalRes;
      }
    }
    convergenceHistory.push(gBestCost);
    convergenceEvals.push(E.used);

    const S = particles.length;
    for (let iter = 1; iter <= maxIterations && !E.done(); iter++) {
      const alpha = alphaMax - Math.min(1, progress(iter)) * (alphaMax - alphaMin);

      // Mean Best Position (mbest) across all personal bests
      const mBest = new Float64Array(numCustomers);
      for (let d = 0; d < numCustomers; d++) {
        let sum = 0;
        for (let p = 0; p < S; p++) sum += particles[p].pBestPosition[d];
        mBest[d] = sum / S;
      }

      for (let p = 0; p < S && !E.done(); p++) {
        const particle = particles[p];
        for (let d = 0; d < numCustomers; d++) {
          // Stochastic attractor point between pBest and gBest
          const phi = rng();
          const pLocalAttractor = phi * particle.pBestPosition[d] + (1 - phi) * gBestPosition[d];
          // Delta-well collapse: |psi(x)|^2 = (1/L) exp(-2|x - p| / L), L = 2 alpha |mbest - x|
          const u = rng();
          const step = alpha * Math.abs(mBest[d] - particle.position[d]) * Math.log(1 / Math.max(1e-10, u));
          particle.position[d] = rng() >= 0.5 ? pLocalAttractor + step : pLocalAttractor - step;
          particle.position[d] = Math.max(0, Math.min(1, particle.position[d]));
        }

        const evalRes = assess(particle.position);
        if (evalRes.cost < particle.pBestCost) {
          particle.pBestCost = evalRes.cost;
          particle.pBestPosition.set(particle.position);
        }
        if (evalRes.cost < gBestCost) {
          gBestCost = evalRes.cost;
          gBestPosition.set(particle.position);
          gBestEvaluation = evalRes;
        }
      }
      // Elite local search: a longer bounded hill climb on the global best tour,
      // written back into gBest (Lamarckian). Counted against the budget.
      if (eliteLsEvals > 0 && !E.done() && gBestEvaluation) {
        const seq = decodeRandomKeys(Array.from(gBestPosition));
        const r = localSearch(seq, gBestEvaluation, E, rng, eliteLsEvals, lsSwap);
        if (r.ev.cost < gBestCost) {
          writeBackKeys(gBestPosition, r.seq, rng);
          gBestCost = r.ev.cost;
          gBestEvaluation = r.ev;
        }
      }
      convergenceHistory.push(gBestCost);
      convergenceEvals.push(E.used);
    }

    const r = packResult('QPSO (Quantum-Inspired Particle Swarm)', 'Quantum-Inspired Metaheuristic', seed, gBestEvaluation, convergenceHistory, convergenceEvals, E, startTime);
    r.variant = { decoder: E.decoder, localSearch: lsMode, lsMaxEvals: lsEvals, lsProbability: lsProb, eliteLsEvals, heuristicSeeds: nSeeded, warmStartTours: warm.length, swarmSize, alphaMax, alphaMin };
    return r;
  }

  // =================================================================
  // 2. GENETIC ALGORITHM (GA) - Order Crossover (OX) & 2-Opt Mutation
  // =================================================================
  function runGA(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const { rng, seed } = resolveRng(config);
    const E = makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, config);
    const numCustomers = nodes.length - 1;
    if (numCustomers === 0) {
      return packResult('Genetic Algorithm (GA)', 'Classical Metaheuristic', seed, E.eval([]), [0], [E.used], E, startTime);
    }
    const popSize = config.popSize || Math.max(30, Math.min(80, numCustomers * 3));
    const maxIterations = E.limited ? Infinity : config.maxIterations || 100;
    const mutationRate = config.mutationRate || 0.25;
    const elitismCount = 2;

    const baseSeq = Array.from({ length: numCustomers }, (_, i) => i + 1);
    let population = [];
    const convergenceHistory = [];
    const convergenceEvals = [];

    for (let i = 0; i < popSize && !E.done(); i++) {
      const chrom = shuffle(baseSeq, rng);
      const evalRes = E.eval(chrom);
      population.push({ chromosome: chrom, evalRes, cost: evalRes.cost });
    }

    population.sort((a, b) => a.cost - b.cost);
    let best = population[0];
    convergenceHistory.push(best.cost);
    convergenceEvals.push(E.used);

    function tournamentSelect() {
      const P = population.length;
      const a = population[Math.floor(rng() * P)];
      const b = population[Math.floor(rng() * P)];
      const c = population[Math.floor(rng() * P)];
      return [a, b, c].reduce((min, curr) => (curr.cost < min.cost ? curr : min));
    }

    // Order Crossover (OX)
    function orderCrossover(parentA, parentB) {
      const size = parentA.length;
      let start = Math.floor(rng() * size);
      let end = Math.floor(rng() * size);
      if (start > end) [start, end] = [end, start];

      const child = new Array(size).fill(-1);
      for (let i = start; i <= end; i++) child[i] = parentA[i];

      let pBIdx = 0;
      for (let i = 0; i < size; i++) {
        if (child[i] === -1) {
          while (child.includes(parentB[pBIdx])) pBIdx++;
          child[i] = parentB[pBIdx];
          pBIdx++;
        }
      }
      return child;
    }

    // 2-Opt local inversion mutation
    function mutate2Opt(chrom) {
      const mutated = chrom.slice();
      if (rng() < mutationRate && mutated.length > 3) {
        let i = Math.floor(rng() * mutated.length);
        let j = Math.floor(rng() * mutated.length);
        if (i > j) [i, j] = [j, i];
        while (i < j) {
          [mutated[i], mutated[j]] = [mutated[j], mutated[i]];
          i++;
          j--;
        }
      }
      return mutated;
    }

    for (let iter = 1; iter <= maxIterations && !E.done(); iter++) {
      const nextPop = population.slice(0, elitismCount);
      while (nextPop.length < popSize && !E.done()) {
        const p1 = tournamentSelect().chromosome;
        const p2 = tournamentSelect().chromosome;
        const childChrom = mutate2Opt(orderCrossover(p1, p2));
        const evalRes = E.eval(childChrom);
        nextPop.push({ chromosome: childChrom, evalRes, cost: evalRes.cost });
      }
      population = nextPop.sort((a, b) => a.cost - b.cost);
      if (population[0].cost < best.cost) best = population[0];
      convergenceHistory.push(best.cost);
      convergenceEvals.push(E.used);
    }

    return packResult('Genetic Algorithm (GA)', 'Classical Metaheuristic', seed, best.evalRes, convergenceHistory, convergenceEvals, E, startTime);
  }

  // =================================================================
  // 3. ANT COLONY OPTIMIZATION (ACO) - Pheromone Trail Matrix
  // =================================================================
  function runACO(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const { rng, seed } = resolveRng(config);
    const E = makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, config);
    const numCustomers = nodes.length - 1;
    const numAnts = config.numAnts || Math.max(20, Math.min(50, numCustomers * 2));
    const maxIterations = E.limited ? Infinity : config.maxIterations || 100;
    const alpha = config.alpha || 1.0; // Pheromone importance
    const beta = config.beta || 2.5; // Heuristic visibility importance
    const rho = config.rho || 0.15; // Evaporation rate
    const Q = 100.0;

    const n = nodes.length;
    const pheromone = Array.from({ length: n }, () => new Float64Array(n).fill(1.0));
    const visibility = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 1.0 / Math.max(0.01, matrix.dist[i][j])))
    );

    let globalBest = null;
    let globalBestCost = Infinity;
    const convergenceHistory = [];
    const convergenceEvals = [];

    // eta^beta never changes, tau^alpha only once per iteration: precompute both
    // instead of calling Math.pow twice per candidate per step (profiled: ~96% of
    // ACO time). Same values, same candidate order, same random draws, so results
    // are identical for a given seed.
    const etaPow = visibility.map((row) => Float64Array.from(row, (v) => Math.pow(v, beta)));
    const tauPow = Array.from({ length: n }, () => new Float64Array(n));
    const probs = new Float64Array(Math.max(1, numCustomers));

    for (let iter = 1; iter <= maxIterations && !E.done(); iter++) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) tauPow[i][j] = Math.pow(pheromone[i][j], alpha);
      for (let ant = 0; ant < numAnts && !E.done(); ant++) {
        const candidates = Array.from({ length: numCustomers }, (_, i) => i + 1); // unvisited, in insertion order
        const tour = [];
        let currNode = 0; // Depot

        while (candidates.length > 0) {
          const tauRow = tauPow[currNode], etaRow = etaPow[currNode];
          let sum = 0;
          for (let i = 0; i < candidates.length; i++) {
            const p = tauRow[candidates[i]] * etaRow[candidates[i]];
            probs[i] = p;
            sum += p;
          }
          // Roulette wheel selection
          let r = rng() * (sum || 1);
          let pick = 0;
          for (let i = 0; i < candidates.length; i++) {
            r -= probs[i];
            if (r <= 0) {
              pick = i;
              break;
            }
          }
          const chosen = candidates[pick];
          tour.push(chosen);
          candidates.splice(pick, 1);
          currNode = chosen;
        }

        const evalRes = E.eval(tour);
        if (evalRes.cost < globalBestCost) {
          globalBestCost = evalRes.cost;
          globalBest = { tour, evalRes, cost: evalRes.cost };
        }
      }

      // Evaporation
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          pheromone[i][j] *= 1.0 - rho;
          if (pheromone[i][j] < 0.01) pheromone[i][j] = 0.01;
        }
      }

      // Pheromone deposit by best ant
      if (globalBest) {
        const deposit = Q / Math.max(1, globalBest.evalRes.totalDist);
        let prev = 0;
        for (const c of globalBest.tour) {
          pheromone[prev][c] += deposit;
          pheromone[c][prev] += deposit;
          prev = c;
        }
        pheromone[prev][0] += deposit;
      }

      convergenceHistory.push(globalBestCost);
      convergenceEvals.push(E.used);
    }

    return packResult('Ant Colony Optimization (ACO)', 'Classical Metaheuristic', seed, globalBest.evalRes, convergenceHistory, convergenceEvals, E, startTime);
  }

  // =================================================================
  // 4. SIMULATED ANNEALING (SA) - Metropolis Acceptance
  // =================================================================
  function runSA(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const { rng, seed } = resolveRng(config);
    const E = makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, config);
    const numCustomers = nodes.length - 1;
    if (numCustomers === 0) {
      return packResult('Simulated Annealing (SA)', 'Classical Metaheuristic', seed, E.eval([]), [0], [E.used], E, startTime);
    }
    const initialTemp = config.initialTemp || 500;
    const stepsPerTemp = Math.max(15, numCustomers * 2);
    const maxIterations = E.limited ? Infinity : config.maxIterations || 100;
    // Under a budget, stretch the cooling so the run spans the same temperature
    // range as the default schedule (500 * 0.96^100 ~ 8.4 at the end).
    let coolingRate = config.coolingRate || 0.96;
    if (E.limited && !config.coolingRate) {
      const levels = Math.max(1, Math.ceil((E.budget - 1) / stepsPerTemp));
      coolingRate = Math.pow(Math.pow(0.96, 100), 1 / levels);
    }

    let currentTour = shuffle(Array.from({ length: numCustomers }, (_, i) => i + 1), rng);
    let currentEval = E.eval(currentTour);
    let currentCost = currentEval.cost;
    let bestEval = currentEval;
    let bestCost = currentCost;

    let temp = initialTemp;
    const convergenceHistory = [bestCost];
    const convergenceEvals = [E.used];

    for (let iter = 1; iter <= maxIterations && !E.done(); iter++) {
      for (let s = 0; s < stepsPerTemp && !E.done(); s++) {
        // Neighborhood 2-opt or swap perturbation
        const neighbor = currentTour.slice();
        const op = rng();
        if (op < 0.6 && neighbor.length > 2) {
          let i = Math.floor(rng() * neighbor.length);
          let j = Math.floor(rng() * neighbor.length);
          if (i > j) [i, j] = [j, i];
          while (i < j) {
            [neighbor[i], neighbor[j]] = [neighbor[j], neighbor[i]];
            i++;
            j--;
          }
        } else {
          const i = Math.floor(rng() * neighbor.length);
          const j = Math.floor(rng() * neighbor.length);
          [neighbor[i], neighbor[j]] = [neighbor[j], neighbor[i]];
        }

        const neighborEval = E.eval(neighbor);
        const delta = neighborEval.cost - currentCost;
        // Metropolis acceptance condition
        if (delta < 0 || Math.exp(-delta / Math.max(0.1, temp)) > rng()) {
          currentTour = neighbor;
          currentEval = neighborEval;
          currentCost = neighborEval.cost;
          if (currentCost < bestCost) {
            bestCost = currentCost;
            bestEval = currentEval;
          }
        }
      }
      temp *= coolingRate;
      convergenceHistory.push(bestCost);
      convergenceEvals.push(E.used);
    }

    return packResult('Simulated Annealing (SA)', 'Classical Metaheuristic', seed, bestEval, convergenceHistory, convergenceEvals, E, startTime);
  }

  // =================================================================
  // 5. CLARKE-WRIGHT SAVINGS (greedy constructive heuristic)
  // =================================================================
  // Walk one explicit route from the depot at t = 0 (same rules as evaluateTourSequence).
  function walkRoute(route, nodes, matrix) {
    let t = 0, prev = 0, dist = 0, late = 0, wait = 0, load = 0, drive = 0;
    for (const c of route) {
      const cust = nodes[c];
      dist += matrix.dist[prev][c];
      drive += matrix.time[prev][c];
      const arrival = t + matrix.time[prev][c];
      const w = Math.max(0, (cust.readyTime || 0) - arrival);
      wait += w;
      late += Math.max(0, arrival - (cust.dueTime || Infinity));
      t = arrival + w + (cust.serviceTime || 5);
      load += cust.demand;
      prev = c;
    }
    dist += matrix.dist[prev][0];
    drive += matrix.time[prev][0];
    const finishTime = t + matrix.time[prev][0];
    const depotDue = nodes[0] && isNum(nodes[0].dueTime) ? nodes[0].dueTime : Infinity;
    late += Math.max(0, finishTime - depotDue); // back after the depot closes
    return { dist, late, wait, load, drive, finishTime };
  }

  // Score explicit routes with the same objective as evaluateTourSequence, so a
  // heuristic that builds its own routes is compared like-for-like.
  function evaluateRoutes(routeList, nodes, matrix, vehicleCapacity, numVehicles, opts = {}) {
    const penaltyCapWeight = opts.penaltyCap || 1500;
    const penaltyTimeWeight = opts.penaltyTime || 20;
    let totalDist = 0, totalTime = 0, cap = 0, late = 0, wait = 0;
    const routes = routeList.filter((r) => r.length).map((r) => {
      const w = walkRoute(r, nodes, matrix);
      totalDist += w.dist;
      totalTime += w.finishTime;
      cap += Math.max(0, w.load - vehicleCapacity);
      late += w.late;
      wait += w.wait;
      return { customers: r.slice(), load: w.load, capacity: vehicleCapacity, finishTime: w.finishTime, distKm: w.dist, driveTimeMin: w.drive };
    });
    const fleetExcess = Math.max(0, routes.length - numVehicles);
    return {
      cost: totalDist + totalTime * 0.4 + cap * penaltyCapWeight + late * penaltyTimeWeight + fleetExcess * 10000,
      totalDist: parseFloat(totalDist.toFixed(2)),
      totalTime: parseFloat(totalTime.toFixed(1)),
      routes,
      totalCapViolations: cap,
      totalTimeViolations: parseFloat(late.toFixed(1)),
      totalWaitTime: parseFloat(wait.toFixed(1)),
      fleetExcess
    };
  }

  // Savings-based route construction (Clarke & Wright 1964). Merges route ends in
  // order of distance saving s_ij = d_0i + d_0j - d_ij, subject to capacity.
  // opts.timeWindows (default true): a merge is also rejected if the merged route
  // would be later in total than its two parts (so feasible routes stay on time).
  // With timeWindows: false this is the classic capacity-only version.
  function clarkeWrightRoutes(nodes, matrix, vehicleCapacity, opts = {}) {
    const useTW = opts.timeWindows !== false;
    const numCustomers = nodes.length - 1;
    const { dist } = matrix;

    const savings = [];
    for (let i = 1; i <= numCustomers; i++) {
      for (let j = i + 1; j <= numCustomers; j++) {
        savings.push({ i, j, s: dist[0][i] + dist[0][j] - dist[i][j] });
      }
    }
    savings.sort((a, b) => b.s - a.s || a.i - b.i || a.j - b.j);

    let routes = [];
    const nodeToRoute = {};
    for (let i = 1; i <= numCustomers; i++) {
      const r = [i];
      routes.push(r);
      nodeToRoute[i] = r;
    }
    const getLoad = (route) => route.reduce((sum, id) => sum + nodes[id].demand, 0);
    const lateOf = (route) => walkRoute(route, nodes, matrix).late;

    for (const { i, j } of savings) {
      const routeI = nodeToRoute[i];
      const routeJ = nodeToRoute[j];
      if (!routeI || !routeJ || routeI === routeJ) continue;
      const iIsStart = routeI[0] === i;
      const iIsEnd = routeI[routeI.length - 1] === i;
      const jIsStart = routeJ[0] === j;
      const jIsEnd = routeJ[routeJ.length - 1] === j;
      if (!((iIsStart || iIsEnd) && (jIsStart || jIsEnd))) continue;
      if (getLoad(routeI) + getLoad(routeJ) > vehicleCapacity) continue;

      let merged = [];
      if (iIsEnd && jIsStart) merged = routeI.concat(routeJ);
      else if (iIsStart && jIsEnd) merged = routeJ.concat(routeI);
      else if (iIsEnd && jIsEnd) merged = routeI.concat(routeJ.slice().reverse());
      else if (iIsStart && jIsStart) merged = routeI.slice().reverse().concat(routeJ);
      if (useTW && lateOf(merged) > lateOf(routeI) + lateOf(routeJ) + 1e-9) continue;

      routes = routes.filter((r) => r !== routeI && r !== routeJ);
      routes.push(merged);
      for (const id of merged) nodeToRoute[id] = merged;
    }
    return routes;
  }

  // Concatenated customer order of the classic (capacity-only) savings routes.
  // Used as one of QPSO's seed tours; kept classic so the benchmarked QPSO
  // configuration is unchanged.
  function clarkeWrightSequence(nodes, matrix, vehicleCapacity) {
    return clarkeWrightRoutes(nodes, matrix, vehicleCapacity, { timeWindows: false }).flat();
  }

  const CW_LABEL = 'Clarke-Wright Savings (greedy constructive heuristic)';

  // Evaluated on its own routes (not re-split), with the same cost function as
  // every other algorithm. Savings does not limit the number of routes, so if it
  // needs more vehicles than the fleet has, the excess is penalised and flagged.
  function runClarkeWright(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const respectsTimeWindows = config.timeWindows !== false;
    const routes = clarkeWrightRoutes(nodes, matrix, vehicleCapacity, { timeWindows: respectsTimeWindows });
    const E = { used: 1, limited: false, budget: Infinity };
    const evalRes = evaluateRoutes(routes, nodes, matrix, vehicleCapacity, numVehicles);
    const r = packResult(CW_LABEL, 'Classical Deterministic Heuristic', undefined, evalRes, [evalRes.cost, evalRes.cost], [1, 1], E, startTime);
    r.respectsTimeWindows = respectsTimeWindows;
    r.vehiclesNeeded = evalRes.routes.length;
    r.fleetExcess = evalRes.fleetExcess;
    const notes = [];
    notes.push(respectsTimeWindows
      ? 'Time windows checked when merging routes.'
      : 'Ignores time windows (classic savings): its lateness is not a like-for-like comparison.');
    if (evalRes.fleetExcess > 0) {
      notes.push(`Needs ${evalRes.routes.length} vehicles but the fleet has ${numVehicles}; each extra vehicle is penalised.`);
    }
    if (evalRes.totalTimeViolations > 0 && respectsTimeWindows) {
      notes.push('Some lateness remains on routes that were already late as single stops or merged without adding lateness.');
    }
    r.notes = notes;
    return r;
  }

  // =================================================================
  // 5b. EXACT SOLVER (Heap's algorithm over all customer orders)
  // Optimal over the same sequence-split search space the metaheuristics use
  // (every customer order, split into vehicles greedily by capacity). It is not
  // a proof of optimality for the full CVRPTW: a method that builds its own
  // routes (Clarke-Wright) can occasionally find a cheaper plan outside that space.
  // =================================================================
  function runExact(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    const startTime = performance.now();
    validateInstance(nodes, vehicleCapacity, numVehicles);
    const n = nodes.length - 1;
    const limit = config.maxCustomers || 9;
    if (n > limit) return { skipped: true, reason: `Exact enumeration limited to ${limit} customers (n! growth)`, algorithm: 'Exact (Exhaustive)' };
    // decoder 'split': every order with its optimal route breaks = the true optimum (<= K vehicles).
    const E = makeEvaluator(nodes, matrix, vehicleCapacity, numVehicles, { decoder: config.decoder || 'split' });
    const a = Array.from({ length: n }, (_, i) => i + 1);
    let best = Infinity;
    let bestEv = null;
    const conv = [];
    const convEvals = [];
    const visit = () => {
      const ev = E.eval(a);
      if (ev.cost < best) {
        best = ev.cost;
        bestEv = ev;
        conv.push(best);
        convEvals.push(E.used);
      }
    };
    const c = new Array(n).fill(0);
    visit();
    for (let i = 0; i < n; ) {
      if (c[i] < i) {
        const k = i % 2 === 0 ? 0 : c[i];
        [a[k], a[i]] = [a[i], a[k]];
        visit();
        c[i]++;
        i = 0;
      } else {
        c[i] = 0;
        i++;
      }
    }
    const r = packResult(E.decoder === 'split' ? 'Exact (enumeration + optimal split)' : 'Exact (optimum over greedy-split tours)', 'Exact Method', undefined, bestEv, conv, convEvals, E, startTime);
    r.evaluated = E.used;
    return r;
  }

  // =================================================================
  // 6. BENCHMARK SUITE: N independent seeded runs per algorithm
  // =================================================================
  // Equal effort: every stochastic algorithm gets the same objective-evaluation
  // budget per run (default below; override with config.maxEvaluations).
  // Chosen up front as a size-based rule, not tuned per algorithm.
  function defaultEvaluationBudget(numCustomers) {
    return Math.max(2000, Math.min(20000, 300 * numCustomers));
  }

  function summarize(values) {
    const m = values.reduce((s, x) => s + x, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, x) => s + (x - m) * (x - m), 0) / values.length);
    return { mean: m, std: sd, best: Math.min(...values), worst: Math.max(...values) };
  }

  // Mean best-so-far cost at each convergence point (curves are padded with their last value).
  function meanCurve(curves) {
    const L = Math.max(...curves.map((c) => c.length));
    const out = [];
    for (let i = 0; i < L; i++) {
      let s = 0;
      for (const c of curves) s += c[Math.min(i, c.length - 1)];
      out.push(s / curves.length);
    }
    return out;
  }

  // Mean best-so-far cost sampled at fixed fractions of the evaluation budget,
  // so curves from different algorithms share one x-axis (evaluations).
  function meanCurveByEvals(runs, budget, points = 50) {
    const xs = Array.from({ length: points + 1 }, (_, k) => Math.round((budget * k) / points));
    const ys = xs.map((x) => {
      let s = 0;
      for (const r of runs) {
        let v = r.convergence[0];
        for (let i = 0; i < r.convergenceEvals.length && r.convergenceEvals[i] <= x; i++) v = r.convergence[i];
        s += v;
      }
      return s / runs.length;
    });
    return { evals: xs, cost: ys };
  }

  const DEFAULT_ALGORITHMS = { QPSO: runQPSO, GA: runGA, ACO: runACO, SA: runSA };

  // config: runs (default 10), maxEvaluations (default defaultEvaluationBudget(n)),
  //         seed/rng, algorithms ({name: fn}), exactLimit (default 8; -1 disables),
  //         plus any per-solver options. Gap is measured against the exact
  //         optimum when it is computed, otherwise against the best cost any
  //         algorithm found on this instance.
  function runFullBenchmark(nodes, matrix, vehicleCapacity, numVehicles, config = {}) {
    validateInstance(nodes, vehicleCapacity, numVehicles, config);
    const seed = resolveSeed(config);
    const numCustomers = nodes.length - 1;
    const runs = Math.max(1, Math.floor(config.runs ?? 10));
    const budget = config.maxEvaluations > 0 ? Math.floor(config.maxEvaluations) : defaultEvaluationBudget(numCustomers);
    const algorithms = config.algorithms || DEFAULT_ALGORITHMS;
    const exactLimit = config.exactLimit ?? 8;

    const exact = numCustomers <= exactLimit ? runExact(nodes, matrix, vehicleCapacity, numVehicles, { maxCustomers: exactLimit }) : null;

    const perAlgo = Object.entries(algorithms).map(([key, fn], ai) => {
      const algoSeed = deriveSeed(seed, ai);
      const all = [];
      for (let i = 0; i < runs; i++) {
        const sub = Object.assign({}, config, { rng: undefined, seed: deriveSeed(algoSeed, i), maxEvaluations: budget });
        delete sub.algorithms;
        delete sub.runs;
        all.push(fn(nodes, matrix, vehicleCapacity, numVehicles, sub));
      }
      return { key, all };
    });
    const cwRes = runClarkeWright(nodes, matrix, vehicleCapacity, numVehicles);

    const allCosts = perAlgo.flatMap((a) => a.all.map((r) => r.bestCost)).concat(cwRes.bestCost);
    // 'exact' = optimum of the sequence-split space. If Clarke-Wright (own routes)
    // is cheaper, it becomes the reference so no gap is negative.
    const reference = exact && exact.bestCost <= cwRes.bestCost + 1e-9
      ? { cost: exact.bestCost, kind: 'exact', evaluations: exact.evaluated }
      : { cost: Math.min(...allCosts, exact ? exact.bestCost : Infinity), kind: 'best-found' };
    // Gap in %; with a zero reference (no stops) every plan costs 0, so the gap is 0.
    const gap = (c) => (reference.cost > 0 ? parseFloat((((c - reference.cost) / reference.cost) * 100).toFixed(2)) : 0);
    const median = (a) => { const v = a.slice().sort((x, y) => x - y), h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };

    const summary = {};
    const results = perAlgo.map(({ key, all }) => {
      const costs = all.map((r) => r.bestCost);
      const s = summarize(costs);
      const bestRun = all.reduce((b, r) => (r.bestCost < b.bestCost ? r : b));
      const stats = {
        runs,
        seeds: all.map((r) => r.seed),
        costs,
        mean: parseFloat(s.mean.toFixed(2)),
        std: parseFloat(s.std.toFixed(2)),
        best: s.best,
        worst: s.worst,
        median: parseFloat(median(costs).toFixed(2)),
        feasibleRuns: all.filter((r) => r.feasible).length,
        feasibleRatePct: Math.round((all.filter((r) => r.feasible).length / runs) * 100),
        gapPct: gap(s.mean),
        bestGapPct: gap(s.best),
        hitRatePct: Math.round((costs.filter((c) => c <= reference.cost + 1e-6).length / runs) * 100),
        meanEvaluations: Math.round(all.reduce((t, r) => t + r.evaluations, 0) / runs),
        meanTimeMs: parseFloat((all.reduce((t, r) => t + r.executionTimeMs, 0) / runs).toFixed(2)),
        meanConvergence: meanCurve(all.map((r) => r.convergence)),
        convergenceByEvals: meanCurveByEvals(all, budget)
      };
      summary[key] = stats;
      // Representative run for maps/manifests = the best of the N runs.
      return Object.assign({}, bestRun, { key, stats });
    });

    cwRes.key = 'CW';
    cwRes.stats = {
      runs: 1, seeds: [], costs: [cwRes.bestCost], mean: cwRes.bestCost, std: 0, best: cwRes.bestCost, worst: cwRes.bestCost,
      median: cwRes.bestCost, feasibleRuns: cwRes.feasible ? 1 : 0, feasibleRatePct: cwRes.feasible ? 100 : 0,
      gapPct: gap(cwRes.bestCost), bestGapPct: gap(cwRes.bestCost), hitRatePct: cwRes.bestCost <= reference.cost + 1e-6 ? 100 : 0,
      meanEvaluations: 1, meanTimeMs: cwRes.executionTimeMs, meanConvergence: cwRes.convergence, convergenceByEvals: null
    };
    summary.CW = cwRes.stats;
    results.push(cwRes);

    // Improvement against Clarke-Wright baseline (representative runs)
    const baselineDist = cwRes.totalDistKm || 1;
    results.forEach((r) => {
      r.distImprovementPct = parseFloat((((baselineDist - r.totalDistKm) / baselineDist) * 100).toFixed(1));
    });

    return {
      seed,
      runs,
      maxEvaluations: budget,
      reference,
      exact,
      results,
      summary,
      // Ranked by mean cost over the N runs, not by a single lucky run.
      bestAlgorithm: results.slice().sort((a, b) => a.stats.mean - b.stats.mean)[0],
      // True if at least one algorithm found a plan with no violations.
      anyFeasible: results.some((r) => r.feasible),
      // Why a feasible plan may be impossible (e.g. demand above fleet capacity).
      diagnostics: instanceDiagnostics(nodes, vehicleCapacity, numVehicles),
      traffic: matrix.traffic || null,
      instanceSummary: {
        numCustomers,
        vehicleCapacity,
        numVehicles,
        depotCoords: { lat: nodes[0].lat, lng: nodes[0].lng }
      }
    };
  }

  // =================================================================
  // 7. SCALABILITY TESTING SUITE (10, 25, 50, 100 Nodes)
  // =================================================================
  // opts.seed / opts.rng make the instance reproducible. The seed used is attached
  // to the returned array as a non-enumerable `seed` property (not serialised).
  function generateBenchmarkInstance(size = 10, center = { lat: 17.385, lng: 78.4867 }, opts = {}) {
    const { rng, seed } = resolveRng(opts);
    const nodes = [
      {
        id: 0,
        name: 'Central Fleet Logistics Depot',
        lat: center.lat,
        lng: center.lng,
        x: 0,
        y: 0,
        demand: 0,
        readyTime: 0,
        dueTime: 720,
        serviceTime: 0
      }
    ];

    // Seeded generation of realistic cluster deliveries
    for (let i = 1; i <= size; i++) {
      const angle = rng() * Math.PI * 2;
      const radiusKm = 0.5 + rng() * 12.0;
      const dLat = (radiusKm * Math.cos(angle)) / 111.0;
      const dLng =
        (radiusKm * Math.sin(angle)) / (111.0 * Math.cos((center.lat * Math.PI) / 180));

      const ready = Math.floor(rng() * 240); // 0 to 4 hours from start
      const windowSpan = 60 + Math.floor(rng() * 120); // 1-2 hour delivery window

      nodes.push({
        id: i,
        name: `Delivery Stop #${i}`,
        lat: parseFloat((center.lat + dLat).toFixed(5)),
        lng: parseFloat((center.lng + dLng).toFixed(5)),
        x: radiusKm * Math.cos(angle),
        y: radiusKm * Math.sin(angle),
        demand: Math.floor(rng() * 18) + 5, // 5 to 22 kg
        readyTime: ready,
        dueTime: ready + windowSpan,
        serviceTime: 10 // 10 minutes service time
      });
    }
    Object.defineProperty(nodes, 'seed', { value: seed, enumerable: false, writable: true, configurable: true });
    return nodes;
  }

  // config.seed / config.rng make the whole study reproducible; each row records
  // its own instance seed and per-algorithm seeds.
  function runScalabilityStudy(sizes = [10, 25, 50], center = { lat: 17.385, lng: 78.4867 }, config = {}) {
    const studyResults = [];
    const baseSeed = resolveSeed(config);

    sizes.forEach((size, idx) => {
      const numVehicles = Math.max(2, Math.ceil(size / 6));
      const vehicleCap = 80;
      const rowSeed = deriveSeed(baseSeed, idx);
      const nodes = generateBenchmarkInstance(size, center, { seed: deriveSeed(rowSeed, 0) });
      const matrix = buildCostMatrix(nodes, 1.1);

      // Same evaluation budget for all three (single run each per size).
      const maxEvaluations = config.maxEvaluations || defaultEvaluationBudget(size);
      const qpso = runQPSO(nodes, matrix, vehicleCap, numVehicles, { maxEvaluations, seed: deriveSeed(rowSeed, 1) });
      const ga = runGA(nodes, matrix, vehicleCap, numVehicles, { maxEvaluations, seed: deriveSeed(rowSeed, 2) });
      const sa = runSA(nodes, matrix, vehicleCap, numVehicles, { maxEvaluations, seed: deriveSeed(rowSeed, 3) });

      studyResults.push({
        nodeCount: size,
        vehicles: numVehicles,
        maxEvaluations,
        seed: baseSeed,
        instanceSeed: nodes.seed,
        qpso: { timeMs: qpso.executionTimeMs, distKm: qpso.totalDistKm, cost: qpso.bestCost, seed: qpso.seed },
        ga: { timeMs: ga.executionTimeMs, distKm: ga.totalDistKm, cost: ga.bestCost, seed: ga.seed },
        sa: { timeMs: sa.executionTimeMs, distKm: sa.totalDistKm, cost: sa.bestCost, seed: sa.seed }
      });
    });

    return studyResults;
  }

  // --- Public API ---
  return {
    makeRng,
    deriveSeed,
    QFlowInputError,
    validateInstance,
    instanceDiagnostics,
    feasibilityOf,
    trafficProfile,
    MAX_CUSTOMERS,
    resolveRng,
    resolveSeed,
    buildCostMatrix,
    computeCongestedTime,
    evaluateTourSequence,
    splitTourSequence,
    evaluateRoutes,
    makeEvaluator,
    co2GramsOf,
    decodeRandomKeys,
    encodeRandomKeys,
    nearestNeighbourSequence,
    clarkeWrightSequence,
    clarkeWrightRoutes,
    CW_LABEL,
    defaultEvaluationBudget,
    summarize,
    QPSO_DEFAULTS,
    runQPSO,
    runGA,
    runACO,
    runSA,
    runClarkeWright,
    runExact,
    runFullBenchmark,
    generateBenchmarkInstance,
    runScalabilityStudy
  };
});
