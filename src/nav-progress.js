/* =========================================================
   Q-FLOW — NAVIGATION: RouteProgressService, off-route detection, arrival,
   voice announcement planning and bearing filtering. Pure logic, no DOM.
   UMD: browser global QFlowNavProgress, or require() in Node tests.
   Inputs are real GPS fixes { lat, lng, accuracy, heading, speed, timestamp } and a
   NavRoute from nav-routing.js. Nothing here creates or moves positions.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNavProgress = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const angleDiff = (a, b) => ((b - a + 540) % 360) - 180; // signed shortest a -> b, -180..180
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function haversineM(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearingDeg(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return norm360(deg(Math.atan2(y, x)));
  }

  // Nearest point on segment i of the route to p: { d, t, along }.
  function segProject(route, i, p) {
    const A = route.coords[i], B = route.coords[i + 1];
    const kx = 111320 * Math.cos(rad(p[0])), ky = 110540;
    const ax = (A[1] - p[1]) * kx, ay = (A[0] - p[0]) * ky, bx = (B[1] - p[1]) * kx, by = (B[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
    return { d: Math.hypot(ax + t * dx, ay + t * dy), t, along: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]) };
  }

  // Projects a position onto the route. Searches near the last known segment first and
  // prefers forward progress, so overlapping or parallel roads do not make it jump back.
  function project(route, p, hint) {
    const n = route.coords.length - 1;
    const scan = (lo, hi) => {
      let best = null;
      for (let i = Math.max(0, lo); i < Math.min(n, hi); i++) {
        const r = segProject(route, i, p);
        const back = hint && hint.alongM !== undefined ? Math.max(0, hint.alongM - r.along - 30) : 0;
        const score = r.d + (back > 0 ? 20 + back * 0.5 : 0); // going backwards must be clearly closer
        if (!best || score < best.score) best = Object.assign(r, { i, score });
      }
      return best;
    };
    let best = hint && isNum(hint.seg) ? scan(hint.seg - 3, hint.seg + 80) : null;
    if (!best || best.d > 60) {
      const all = scan(0, n);
      if (!best || all.score < best.score) best = all;
    }
    const A = route.coords[best.i], B = route.coords[best.i + 1];
    return {
      seg: best.i, distM: best.d, alongM: best.along,
      point: [A[0] + (B[0] - A[0]) * best.t, A[1] + (B[1] - A[1]) * best.t],
      routeBearing: bearingDeg(A, B)
    };
  }

  // Seconds of travel left from alongM, from the provider's per-step durations
  // (linear within a step), scaled to the route's total duration.
  function timeRemainingS(route, alongM) {
    const steps = route.steps;
    let left = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], end = s.alongM + s.distanceM;
      if (end <= alongM) continue;
      if (s.alongM >= alongM) left += s.durationS;
      else if (s.distanceM > 0) left += s.durationS * ((end - alongM) / s.distanceM);
    }
    const sum = steps.reduce((a, s) => a + s.durationS, 0);
    if (sum > 0 && isNum(route.durationS) && route.durationS > 0) left *= route.durationS / sum;
    else if (!(sum > 0)) left = (route.durationS || 0) * Math.max(0, route.lengthM - alongM) / Math.max(1, route.lengthM);
    return Math.max(0, left);
  }

  // ---------- RouteProgressService ----------
  function createProgress(route) {
    let hint = null;
    return {
      route,
      update(fix, now) {
        const p = [fix.lat, fix.lng];
        const pr = project(route, p, hint);
        hint = { seg: pr.seg, alongM: Math.max(hint ? hint.alongM - 50 : 0, pr.alongM) };
        const along = pr.alongM;
        let next = route.steps.findIndex((s) => s.alongM > along + 3);
        if (next < 0) next = route.steps.length - 1;
        const cur = Math.max(0, next - 1);
        const remainingM = Math.max(0, route.lengthM - along);
        const remainingS = timeRemainingS(route, along);
        const t = isNum(now) ? now : Date.now();
        return {
          snapped: pr.point, distFromRouteM: pr.distM, alongM: along, seg: pr.seg, routeBearing: pr.routeBearing,
          remainingM, remainingS, arrivalTime: t + remainingS * 1000,
          stepIndex: cur, nextIndex: next, nextStep: route.steps[next], distToNextM: Math.max(0, route.steps[next].alongM - along),
          currentRoad: route.steps[cur].name || '',
          fraction: route.lengthM > 0 ? along / route.lengthM : 1
        };
      }
    };
  }

  // ---------- off-route detection ----------
  // GPS wanders: a fix counts as "away" only beyond max(baseM, accuracy + marginM) (capped),
  // and the user is off route only after `needed` consecutive away fixes spanning minMs.
  // Fixes with very poor accuracy are ignored (neither confirm nor clear).
  function createOffRouteDetector(o) {
    const cfg = Object.assign({ baseM: 40, marginM: 20, maxM: 120, needed: 3, minMs: 4000, ignoreAccuracyM: 80 }, o || {});
    let count = 0, since = null;
    return {
      cfg,
      threshold(acc) { return clamp((isNum(acc) ? acc : 30) + cfg.marginM, cfg.baseM, cfg.maxM); },
      update(distM, accuracy, ts) {
        if (isNum(accuracy) && accuracy > cfg.ignoreAccuracyM) return { offRoute: false, away: false, uncertain: true };
        if (distM > this.threshold(accuracy)) {
          if (!count) since = ts;
          count++;
          return { offRoute: count >= cfg.needed && ts - since >= cfg.minMs, away: true };
        }
        count = 0; since = null;
        return { offRoute: false, away: false };
      },
      reset() { count = 0; since = null; }
    };
  }

  // ---------- arrival ----------
  // Arrived when within an accuracy-based radius (20-50 m) of the destination, or when
  // the remaining route is within that radius while on the route.
  function arrivalRadiusM(accuracy) { return clamp(isNum(accuracy) ? accuracy : 25, 20, 50); }
  function hasArrived(fix, dest, progress) {
    const r = arrivalRadiusM(fix.accuracy);
    const straight = haversineM([fix.lat, fix.lng], [dest.lat, dest.lng]);
    if (straight <= r) return true;
    return !!progress && progress.remainingM <= r && progress.distFromRouteM <= r * 2;
  }

  // ---------- voice announcement planning ----------
  function spokenDistance(m) {
    if (m >= 950) { const km = Math.round(m / 100) / 10; return (km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)) + (km === 1 ? ' kilometre' : ' kilometres'); }
    const r = m >= 300 ? Math.round(m / 100) * 100 : Math.max(10, Math.round(m / 50) * 50 || 10);
    return r + ' metres';
  }
  // Each maneuver is announced at most once per stage: far (about 500 m / 1 km at speed),
  // near (about 7 s ahead, at least 100 m) and now (about 2.5 s ahead, at least 25 m).
  function createVoicePlanner() {
    const said = new Set();
    let arrivedSaid = false;
    const once = (k) => (said.has(k) ? false : (said.add(k), true));
    return {
      next(progress, speedMps) {
        const v = isNum(speedMps) && speedMps > 0 ? speedMps : 8;
        const step = progress.nextStep, i = progress.nextIndex, d = progress.distToNextM;
        if (!step) return null;
        const farM = v > 20 ? 1000 : 500, nearM = clamp(v * 7, 100, 300), nowM = clamp(v * 2.5, 25, 60);
        if (step.type === 'arrive') {
          if (d <= nowM) return null; // arrival itself is announced by announceArrival()
          if (d <= nearM && once(i + ':near')) return 'In ' + spokenDistance(d) + ', you will arrive at your destination';
          return null;
        }
        if (d <= nowM) { said.add(i + ':near'); said.add(i + ':far'); return once(i + ':now') ? step.text : null; }
        if (d <= nearM) { said.add(i + ':far'); return once(i + ':near') ? 'In ' + spokenDistance(d) + ', ' + lower(step.text) : null; }
        if (d <= farM && d > nearM + 150 && once(i + ':far')) return 'In ' + spokenDistance(d) + ', ' + lower(step.text);
        // Long straight stretch right after a maneuver: say how long to continue (once).
        if (d > 2000 && progress.stepIndex === i - 1 && once(i + ':continue')) return 'Continue for ' + spokenDistance(Math.round(d / 500) * 500);
        return null;
      },
      announceArrival() { if (arrivedSaid) return null; arrivedSaid = true; return 'You have arrived at your destination'; },
      reset() { said.clear(); }
    };
  }
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);

  // ---------- bearing (direction of travel) ----------
  // Priority: GPS course when moving (>= 2 m/s) > bearing between fixes after >= 10 m of
  // movement > route direction at the snapped point (slow, on route) > compass (stationary).
  // Smoothed on the circle with a dead band, so noise does not shake the map.
  function createBearingFilter(o) {
    const cfg = Object.assign({ minSpeed: 2, minMoveM: 10 }, o || {});
    let value = null, source = 'none', anchor = null;
    const ALPHA = { gps: 0.5, movement: 0.4, route: 0.3, compass: 0.12 };
    const DEAD = { gps: 2, movement: 3, route: 3, compass: 6 };
    return {
      get value() { return value; },
      get source() { return source; },
      update(fix, ctx) {
        const c = ctx || {};
        let raw = null, src = null;
        if (isNum(fix.heading) && isNum(fix.speed) && fix.speed >= cfg.minSpeed) { raw = fix.heading; src = 'gps'; }
        if (raw === null && anchor && (!isNum(fix.accuracy) || fix.accuracy <= 30)) {
          const moved = haversineM(anchor, [fix.lat, fix.lng]);
          if (moved >= cfg.minMoveM) { raw = bearingDeg(anchor, [fix.lat, fix.lng]); src = 'movement'; }
        }
        if (raw === null && isNum(c.routeBearing) && c.onRoute && (!isNum(fix.speed) || fix.speed >= 0.5)) { raw = c.routeBearing; src = 'route'; }
        if (raw === null && isNum(c.compass) && (!isNum(fix.speed) || fix.speed < cfg.minSpeed)) { raw = c.compass; src = 'compass'; }
        if (!anchor || (src && src !== 'compass')) anchor = [fix.lat, fix.lng];
        if (raw === null) return value;
        raw = norm360(raw);
        if (value === null) { value = raw; source = src; return value; }
        const d = angleDiff(value, raw);
        if (Math.abs(d) >= DEAD[src]) value = norm360(value + ALPHA[src] * d);
        source = src;
        return value;
      },
      reset() { value = null; source = 'none'; anchor = null; }
    };
  }

  // ---------- fix validation ----------
  // Rejects fixes that cannot be real movement: missing coordinates, older than the last
  // accepted fix, or an implied speed above 70 m/s (252 km/h) unless accuracy is good.
  function createFixValidator() {
    let last = null;
    return {
      check(fix) {
        if (!fix || !isNum(fix.lat) || !isNum(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return { ok: false, reason: 'invalid' };
        if (last && isNum(fix.timestamp) && isNum(last.timestamp) && fix.timestamp <= last.timestamp) return { ok: false, reason: 'stale' };
        if (last && isNum(fix.timestamp) && isNum(last.timestamp)) {
          const dt = (fix.timestamp - last.timestamp) / 1000;
          // Movement beyond what both accuracy circles explain; a much more accurate fix
          // (e.g. GPS after a coarse network fix) is always accepted.
          const d = Math.max(0, haversineM([last.lat, last.lng], [fix.lat, fix.lng]) - (last.accuracy || 0) - (fix.accuracy || 0));
          const muchBetter = isNum(fix.accuracy) && isNum(last.accuracy) && fix.accuracy * 3 <= last.accuracy;
          if (dt > 0 && d / dt > 70 && !muchBetter && !(isNum(fix.accuracy) && fix.accuracy <= 20 && dt > 5)) return { ok: false, reason: 'jump' };
        }
        last = fix;
        return { ok: true, weak: isNum(fix.accuracy) && fix.accuracy > 50 };
      },
      reset() { last = null; }
    };
  }

  // ---------- display formatting ----------
  function formatDistance(m) {
    if (!isNum(m)) return '–';
    if (m >= 10000) return Math.round(m / 1000) + ' km';
    if (m >= 950) return (m / 1000).toFixed(1) + ' km';
    return (m >= 100 ? Math.round(m / 50) * 50 : Math.max(0, Math.round(m / 10) * 10)) + ' m';
  }
  function formatDuration(s) {
    if (!isNum(s)) return '–';
    const min = Math.max(0, Math.round(s / 60));
    return min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min';
  }

  return {
    haversineM, bearingDeg, angleDiff, norm360, project, timeRemainingS, createProgress, createOffRouteDetector,
    arrivalRadiusM, hasArrived, spokenDistance, createVoicePlanner, createBearingFilter, createFixValidator, formatDistance, formatDuration
  };
});
