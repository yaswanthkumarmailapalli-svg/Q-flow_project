/* =========================================================
   Q-FLOW — ROUTING: vehicle profiles, OSRM requests, route tagging and scoring
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: config.js (qflowNet, QFLOW_CONFIG), emissions.js (QFlowEmissions), ui.js (qflowCssVar).
   ========================================================= */

/* =========================================================
   ROUTING & VEHICLE PROFILE MODEL
   ========================================================= */
const VEHICLE_PROFILES = {
  car: {
    name: 'Standard Car',
    speedFactor: 1.0,
    co2PerKm: 120, // g/km base factor; scaled by the speed curve in emissions.js
    stopPenaltyG: 15, // extra CO2 per stop-and-go cycle (~120 m of cruising)
    energyType: 'Fuel',
    energyPerKm: 0.08, // liters
    color: '#ffffff'
  },
  ev: {
    name: 'Electric Vehicle',
    speedFactor: 1.0,
    co2PerKm: 28, // lifecycle grams
    co2SpeedCurve: false, // EV consumption does not follow the combustion-engine curve: flat factor
    stopPenaltyG: 3,
    energyType: 'Battery',
    energyPerKm: 0.16, // kWh
    color: '#cccccc'
  },
  emergency: {
    name: 'Emergency (Green Corridor)',
    speedFactor: 1.35,
    co2PerKm: 140,
    stopPenaltyG: 0,
    energyType: 'Priority Fuel',
    energyPerKm: 0.1,
    color: '#999999'
  },
  bike: {
    name: 'Two-Wheeler',
    speedFactor: 1.15,
    co2PerKm: 42,
    stopPenaltyG: 6,
    energyType: 'Fuel',
    energyPerKm: 0.025,
    color: '#666666'
  }
};

function _qflowOsrmUrl(points, query) {
  const coordsStr = points.map((p) => (+p.lng).toFixed(6) + ',' + (+p.lat).toFixed(6)).join(';');
  return `${QFLOW_CONFIG.osrmBaseUrl}/route/v1/${QFLOW_CONFIG.osrmProfile}/${coordsStr}?${query}`;
}
function _qflowOsrmGet(url) {
  return qflowNet.getJSON(url, {
    service: 'osrm',
    label: 'The route service (OSRM)',
    ttlMs: QFLOW_CONFIG.cacheTtlMs.route,
    cacheIf: (d) => !!(d && d.code === 'Ok'),
    okStatuses: [400], // OSRM answers NoRoute / InvalidQuery as HTTP 400 with a JSON body
    silent: true // callers show the message in their own route panel
  });
}

// cb(routes) on success, cb(null, error) on failure; error.userMessage is for display.
function qflowRoutes(points, cb0, vehicleType = 'car') {
  const profile = VEHICLE_PROFILES[vehicleType] || VEHICLE_PROFILES.car;
  // With live traffic (traffic-live.js), route times are replaced by TomTom live times before
  // the caller sees them; without it (or if TomTom fails) the OSRM times are kept.
  const cb = (routes, err) => (routes && routes.length ? qflowApplyLiveTimes(routes, profile).then(() => cb0(routes)) : cb0(routes, err));
  const hasStops = points.length > 2;
  const altParam = hasStops ? 'false' : 'true';

  _qflowOsrmGet(_qflowOsrmUrl(points, `alternatives=${altParam}&overview=full&geometries=geojson&steps=true`))
    .then((d) => {
      if (d.code !== 'Ok' || !d.routes || !d.routes.length) {
        cb(null, { kind: 'no-route', userMessage: 'No drivable route was found between these points.' + (d.message ? ' (' + d.message + ')' : '') });
        return;
      }
      let routes = d.routes.map((r) => _qflowBuildRouteObj(r, profile));
      if (hasStops) {
        routes[0].tag = 'Route via your stops';
        routes[0].id = 'A';
        cb(routes.slice(0, 1));
        return;
      }
      if (routes.length >= 2) {
        _qflowFinalizeRoutes(routes, cb);
      } else {
        _qflowEnsureAlternates(points[0], points[1], routes, cb, profile);
      }
    })
    .catch((err) => cb(null, err));
}

// Live travel times from TomTom for each route (same corridor: start, two points along the
// OSRM geometry, end). Sets durationMin to the live time and records where it came from:
//   timeSource 'live' | 'osrm', osrmDurationMin, liveDelayMin (live minus no-traffic time),
//   liveIncidentDelayMin (TomTom's incident/jam delay). Never rejects.
function qflowApplyLiveTimes(routes, profile) {
  routes.forEach((r) => { r.timeSource = r.timeSource || 'osrm'; });
  if (typeof qflowLive === 'undefined' || !qflowLive || !qflowLive.enabled()) return Promise.resolve(routes);
  const mode = profile === VEHICLE_PROFILES.bike ? 'motorcycle' : 'car';
  return Promise.all(routes.map((r) => qflowLive.routeTime(r.geometry && r.geometry.coordinates, mode).then((t) => {
    if (!t || !Number.isFinite(t.travelMin)) return;
    r.osrmDurationMin = r.durationMin;
    r.durationMin = Math.max(1, Math.round(t.travelMin / profile.speedFactor));
    r.baseDurationMin = r.durationMin;
    r.liveDelayMin = t.delayMin === null ? null : Math.round(t.delayMin / profile.speedFactor);
    r.liveIncidentDelayMin = t.incidentDelayMin === null ? null : Math.round(t.incidentDelayMin);
    r.timeSource = 'live';
  }).catch(() => {}))).then(() => {
    // Compare like with like: if any route has no live time, all routes keep OSRM times.
    if (!routes.every((r) => r.timeSource === 'live')) {
      routes.forEach((r) => {
        if (r.timeSource !== 'live') return;
        r.durationMin = r.baseDurationMin = r.osrmDurationMin;
        r.timeSource = 'osrm';
        delete r.liveDelayMin; delete r.liveIncidentDelayMin;
      });
    } else if (routes.length > 1) qflowTagRoutes(routes);
    return routes;
  });
}

// Updates #routeSourceBadge (Plan / Results) for these routes.
function qflowShowRouteSource(routes) {
  const b = typeof document !== 'undefined' && document.getElementById('routeSourceBadge');
  if (!b) return;
  const l = qflowRouteSourceLabel(routes);
  b.textContent = l.text;
  b.title = l.title;
  b.classList.toggle('live-on', l.live);
}

// Badge text for the route panels: where distances and times come from.
function qflowRouteSourceLabel(routes) {
  const live = Array.isArray(routes) && routes.length && routes.every((r) => r.timeSource === 'live');
  return live
    ? { text: 'ROADS: OSM VIA OSRM · TIMES: LIVE TRAFFIC (TOMTOM)', title: 'Road geometry from OSRM on OpenStreetMap. Travel times from TomTom with current traffic.', live: true }
    : { text: 'ROADS: OSM VIA OSRM · NO LIVE TRAFFIC', title: 'Routes and durations come from the OSRM routing service on OpenStreetMap roads. Durations use typical road speeds, not live traffic.', live: false };
}

function _qflowBuildRouteObj(r, profile) {
  const allSteps = (r.legs || []).flatMap((l) => l.steps || []);
  const distKm = parseFloat((r.distance / 1000).toFixed(1));
  const rawDurationMin = r.duration / 60;
  const adjustedDurationMin = Math.max(1, Math.round(rawDurationMin / profile.speedFactor));
  const signals = Math.max(
    1,
    Math.round(
      allSteps.filter(
        (s) =>
          s.maneuver &&
          (s.maneuver.type === 'turn' || s.maneuver.type === 'new name' || s.maneuver.type === 'fork')
      ).length / 2
    )
  );

  const finalSignals = profile === VEHICLE_PROFILES.emergency ? Math.max(0, Math.round(signals * 0.2)) : signals;
  // CO2 estimate (src/emissions.js): distance x speed-dependent factor at the
  // route's average driving speed, plus a stop-and-go penalty per signal stop.
  // OSRM's average speed only partly reflects signal stops, so the penalty is kept.
  // Without a usable speed, the vehicle's flat co2PerKm is used.
  const avgSpeedKmh = rawDurationMin > 0 ? distKm / (rawDurationMin / profile.speedFactor / 60) : NaN;
  const co2Grams = Math.round(
    distKm * QFlowEmissions.gPerKm(avgSpeedKmh, { baseGPerKm: profile.co2PerKm, speedCurve: profile.co2SpeedCurve !== false }) +
      finalSignals * (profile.stopPenaltyG || 0)
  );
  const energyVal = parseFloat((distKm * profile.energyPerKm).toFixed(2));

  return {
    id: null,
    distanceKm: distKm,
    durationMin: adjustedDurationMin,
    geometry: r.geometry,
    signals: finalSignals,
    baseDurationMin: adjustedDurationMin,
    co2Grams: co2Grams, // estimate
    avgSpeedKmh: Number.isFinite(avgSpeedKmh) ? Math.round(avgSpeedKmh) : null,
    energyVal: energyVal,
    energyType: profile.energyType,
    steps: allSteps.map((s) => ({
      name: s.name || 'Road segment',
      distance: Math.round(s.distance),
      duration: Math.round(s.duration),
      instruction: _formatManeuver(s.maneuver),
      // Kept for turn-by-turn navigation (nav-routing.js fromQflowRoute): OSRM maneuver data.
      maneuver: s.maneuver ? { type: s.maneuver.type, modifier: s.maneuver.modifier, location: s.maneuver.location, exit: s.maneuver.exit, bearing_after: s.maneuver.bearing_after } : null,
      ref: s.ref || ''
    }))
  };
}

function _formatManeuver(m) {
  if (!m) return 'Continue straight';
  const type = m.type || 'turn';
  const modifier = m.modifier ? ` ${m.modifier}` : '';
  if (type === 'depart') return 'Head out from starting point';
  if (type === 'arrive') return 'Arrive at destination';
  return `Turn ${modifier || 'onto route'}`.trim();
}

function _qflowEnsureAlternates(origin, dest, existingRoutes, cb, profile) {
  const straightKm = _qflowHaversineKm(origin, dest);
  const offsetKm = Math.max(0.4, Math.min(2.8, straightKm * 0.2));
  const vias = [
    _qflowOffsetPoint(origin, dest, 1, offsetKm),
    _qflowOffsetPoint(origin, dest, -1, offsetKm)
  ];
  Promise.all(vias.map((via) => _qflowFetchViaRoute(origin, via, dest, profile))).then((extra) => {
    let all = existingRoutes.concat(extra.filter(Boolean));
    all = _qflowDedupeRoutes(all);
    if (!all.length) {
      cb(null);
      return;
    }
    _qflowFinalizeRoutes(all, cb);
  });
}

function _qflowFetchViaRoute(origin, via, dest, profile) {
  // Extra alternatives are best-effort: a failure just means fewer choices.
  return _qflowOsrmGet(_qflowOsrmUrl([origin, via, dest], 'overview=full&geometries=geojson&steps=true'))
    .then((d) =>
      d.code === 'Ok' && d.routes && d.routes[0] ? _qflowBuildRouteObj(d.routes[0], profile) : null
    )
    .catch(() => null);
}

function _qflowHaversineKm(a, b) {
  const R = 6371,
    dLat = ((b.lat - a.lat) * Math.PI) / 180,
    dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function _qflowOffsetPoint(a, b, side, offsetKm) {
  const fracAlong = 0.5;
  const midLat = a.lat + (b.lat - a.lat) * fracAlong;
  const midLng = a.lng + (b.lng - a.lng) * fracAlong;
  const dLat = b.lat - a.lat,
    dLng = b.lng - a.lng;
  const len = Math.sqrt(dLat * dLat + dLng * dLng) || 1e-6;
  const perpLat = -dLng / len,
    perpLng = dLat / len;
  const kmPerDegLat = 111,
    kmPerDegLng = 111 * Math.cos((midLat * Math.PI) / 180);
  return {
    lat: midLat + ((perpLat * offsetKm) / kmPerDegLat) * side,
    lng: midLng + ((perpLng * offsetKm) / kmPerDegLng) * side
  };
}

function _qflowDedupeRoutes(routes) {
  const out = [];
  routes.forEach((r) => {
    const dup = out.find(
      (o) => Math.abs(o.distanceKm - r.distanceKm) < 0.08 && Math.abs(o.durationMin - r.durationMin) < 1
    );
    if (!dup) out.push(r);
  });
  out.sort((a, b) => a.durationMin - b.durationMin);
  return out;
}

function _qflowFinalizeRoutes(routes, cb) {
  const top = routes.slice(0, 3);
  top.forEach((r, i) => (r.id = ['A', 'B', 'C'][i]));
  qflowTagRoutes(top);
  cb(top);
}

function qflowTagRoutes(routes) {
  if (routes.length === 1) {
    routes[0].tag = 'Recommended route';
    return;
  }
  const fastest = routes.reduce((a, b) => (a.durationMin < b.durationMin ? a : b));
  const fewestSignals = routes.reduce((a, b) => (a.signals < b.signals ? a : b));
  const greenest = routes.reduce((a, b) => (a.co2Grams < b.co2Grams ? a : b));
  const shortest = routes.reduce((a, b) => (a.distanceKm < b.distanceKm ? a : b));

  routes.forEach((r) => {
    if (r === fastest) r.tag = 'Fastest Corridor (Min Time)';
    else if (r === greenest) r.tag = 'Greenest (Least CO₂)';
    else if (r === fewestSignals) r.tag = 'Smooth Flow (Fewest Stops)';
    else if (r === shortest) r.tag = 'Shortest Distance';
    else r.tag = 'Alternative route';
  });
}

// Route line colours for A/B/C: greyscale, read from the current theme
// (--route-a/b/c). Map lines are also styled by CSS classes qf-route-A/B/C,
// which add the dash patterns that distinguish routes without colour.
const QFLOW_ROUTE_COLORS = Object.defineProperties({}, {
  A: { enumerable: true, get: () => qflowCssVar('--route-a', '#000000') },
  B: { enumerable: true, get: () => qflowCssVar('--route-b', '#474747') },
  C: { enumerable: true, get: () => qflowCssVar('--route-c', '#7a7a7a') }
});
const QFLOW_ROUTE_DASH = { A: null, B: '12 7', C: '1 8' };

/* =========================================================
   ROUTE SCORING (preference-weighted ranking of OSRM routes)
   ========================================================= */
const QFLOW_PREF_WEIGHTS = {
  balanced: { time: 0.35, distance: 0.25, signals: 0.25, co2: 0.15 },
  fast: { time: 0.65, distance: 0.15, signals: 0.1, co2: 0.1 },
  smooth: { time: 0.2, distance: 0.15, signals: 0.5, co2: 0.15 },
  road: { time: 0.2, distance: 0.45, signals: 0.15, co2: 0.2 },
  green: { time: 0.15, distance: 0.25, signals: 0.2, co2: 0.4 }
};

function _qflowNormalize(routes, key) {
  const vals = routes.map((r) => r[key]);
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const span = max - min || 1;
  return routes.map((r) => (r[key] - min) / span);
}

function qflowScoreRoutes(routes, prefKey) {
  const w = QFLOW_PREF_WEIGHTS[prefKey] || QFLOW_PREF_WEIGHTS.balanced;
  const tNorm = _qflowNormalize(routes, 'durationMin');
  const dNorm = _qflowNormalize(routes, 'distanceKm');
  const sNorm = _qflowNormalize(routes, 'signals');
  const cNorm = _qflowNormalize(routes, 'co2Grams');

  routes.forEach((r, i) => {
    const cost =
      w.time * tNorm[i] + w.distance * dNorm[i] + w.signals * sNorm[i] + w.co2 * cNorm[i];
    r.score = Math.max(1, Math.round((1 - cost) * 100));
  });
  // Single-objective preferences rank by their own metric first (the weighted
  // score only breaks ties), so "Fastest" always returns the minimum-time route,
  // "Shortest Distance" the shortest, and so on. "Balanced" uses the score alone.
  const primary = QFLOW_PREF_PRIMARY[prefKey];
  return routes.slice().sort((a, b) => (primary ? a[primary] - b[primary] : 0) || b.score - a.score);
}

const QFLOW_PREF_PRIMARY = { fast: 'durationMin', road: 'distanceKm', smooth: 'signals', green: 'co2Grams' };

