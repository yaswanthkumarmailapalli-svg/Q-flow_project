/* =====================================================================
   Q-FLOW INSIGHTS — small, explainable driver-facing features
   1. Green-wave speed advisory     2. Carpool nudge (simulated demo data)
   3. Eco comparison                4. "Why did my route change?" explainer
   All numbers come from the route object + clearly stated assumptions.
   CO2 figures are estimates (route.co2Grams, see src/emissions.js).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowInsights = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 1. GREEN WAVE -------------------------------------------------
  // Assumption: coordinated signals, cycle C = 90 s, 50% green, evenly spaced.
  // A platoon moving at v = spacing / (n * C/2) meets each next signal as it turns
  // green (progression offset = half a cycle). We pick the n whose speed is
  // closest to a comfortable 40 km/h within 25-55 km/h.
  const CYCLE_S = 90, GREEN_SHARE = 0.5, X_SAT = 0.8;
  function webster() { // average uniform delay per signal (s) for an uncoordinated approach
    const l = GREEN_SHARE;
    return CYCLE_S * Math.pow(1 - l, 2) / (2 * (1 - l * X_SAT));
  }
  function greenWave(route) {
    const S = Math.max(0, route.signals || 0);
    if (S < 2) return { available: false, reason: 'Too few signals on this route for a green wave.' };
    const spacingM = (route.distanceKm * 1000) / S;
    let best = null;
    for (let n = 1; n <= 6; n++) {
      const v = (spacingM / (n * CYCLE_S / 2)) * 3.6;
      if (v < 25 || v > 55) continue;
      if (!best || Math.abs(v - 40) < Math.abs(best.v - 40)) best = { v, n };
    }
    if (!best) return { available: false, reason: 'Signal spacing on this route does not allow a steady green-wave speed.' };
    const speed = Math.round(best.v / 5) * 5;                // driver-friendly: 30, 35, 40 ...
    const avgSpeed = route.distanceKm / (route.durationMin / 60);
    const savedS = Math.round(S * webster() * 0.7);          // ~70% of average signal delay avoided
    return { available: true, speedKmh: speed, spacingM: Math.round(spacingM), signals: S,
      savedSec: savedS, routeAvgKmh: Math.round(avgSpeed), cycleS: CYCLE_S, skipEvery: best.n };
  }

  // ---- 2. CARPOOL (simulated) ---------------------------------------
  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sneha', 'Vikram', 'Ananya'];
  function carpool(route, co2PerKm) {
    const r = rng(Math.round(route.distanceKm * 100) + route.signals * 7 + route.durationMin);
    const count = 2 + Math.floor(r() * 2); // 2-3 matches
    const matches = [];
    const pool = NAMES.slice();
    for (let i = 0; i < count; i++) matches.push({
      name: pool.splice(Math.floor(r() * pool.length), 1)[0],
      overlapPct: 70 + Math.floor(r() * 26),
      departDiffMin: 2 + Math.floor(r() * 9),
      detourMin: 1 + Math.floor(r() * 4)
    });
    const seats = matches.length + 1;
    const perCar = route.co2Grams; // estimate from src/emissions.js (via routing.js)
    return { simulated: true, matches, vehiclesRemoved: matches.length,
      co2SavedGrams: Math.round(perCar * matches.length),       // cars off the road x this route's CO2
      co2PerPersonGrams: Math.round(perCar / seats), seats };
  }

  // ---- 3. ECO COMPARISON --------------------------------------------
  function ecoCompare(routes) {
    if (!routes || routes.length < 2) return null;
    const greenest = routes.reduce((a, b) => (a.co2Grams < b.co2Grams ? a : b));
    const fastest = routes.reduce((a, b) => (a.durationMin < b.durationMin ? a : b));
    if (greenest === fastest) return { same: true, route: greenest };
    const co2Saved = fastest.co2Grams - greenest.co2Grams;
    return { same: false, greenest, fastest, co2Saved,
      co2SavedPct: Math.round((co2Saved / fastest.co2Grams) * 100),
      stopsSaved: fastest.signals - greenest.signals,
      extraMin: greenest.durationMin - fastest.durationMin };
  }

  // ---- 4. WHY DID MY ROUTE CHANGE? ----------------------------------
  function explainSwitch(from, to, cause) {
    const pct = Math.round(((from.durationMin - from.baseDurationMin) / from.baseDurationMin) * 100);
    const save = from.durationMin - to.durationMin;
    let why = `Route ${from.id} slowed by ${pct}% (${from.baseDurationMin} → ${from.durationMin} min)`;
    if (cause) why = `${cause}: ` + why.charAt(0).toLowerCase() + why.slice(1);
    const bonus = [];
    if (to.signals < from.signals) bonus.push(`${from.signals - to.signals} fewer signals`);
    if (to.co2Grams < from.co2Grams) bonus.push(`~${from.co2Grams - to.co2Grams} g less CO₂ (est.)`);
    return `Switched to Route ${to.id}: ${why}. Route ${to.id} now saves ${save} min` + (bonus.length ? ' and has ' + bonus.join(', ') : '') + '.';
  }
  function explainKeep(route, others, prefLabel) {
    const parts = [];
    const o = others.filter(x => x !== route);
    if (o.length) {
      const fasterBy = Math.min(...o.map(x => x.durationMin - route.durationMin));
      if (fasterBy > 0) parts.push(`${fasterBy} min faster than the next best`);
      const sigDiff = Math.min(...o.map(x => x.signals - route.signals));
      if (sigDiff > 0) parts.push(`${sigDiff} fewer signals`);
      const co2Diff = Math.min(...o.map(x => x.co2Grams - route.co2Grams));
      if (co2Diff > 0) parts.push(`~${co2Diff} g less CO₂ (est.)`);
    }
    return `Recommended Route ${route.id} for your "${prefLabel}" priority` + (parts.length ? ': ' + parts.join(', ') : '') + '.';
  }

  return { greenWave, carpool, ecoCompare, explainSwitch, explainKeep, webster };
});
