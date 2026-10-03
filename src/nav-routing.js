/* =========================================================
   Q-FLOW — NAVIGATION: RoutingService (provider-independent road routing)
   UMD: browser global QFlowNavRouting, or require() in Node tests.

   RoutingService.getRoute(origin, destination, options) -> Promise<{ routes, provider }>
   Every provider returns the same NavRoute shape, so providers can be swapped:
     NavRoute = {
       provider,            'tomtom' | 'osrm'
       coords,              [[lat, lng], ...] road geometry
       cum,                 cumulative distance along coords, metres
       lengthM, distanceM, durationS, trafficDelayS (null if unknown)
       steps: [{ alongM, distanceM, durationS, type, modifier, exit, name, text, icon, location }]
     }
   Providers here: TomTom Calculate Route (live traffic, guidance instructions; needs a key)
   and OSRM (OpenStreetMap roads, no key). The first available provider that answers wins.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNavRouting = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function haversineM(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineM(coords[i - 1], coords[i]));
    return cum;
  }

  // Along-route distance of a point, searching forward from fromM (maneuvers come in order).
  function alongOf(coords, cum, p, fromM) {
    let best = { d: Infinity, along: fromM || 0 };
    const ky = 110540, kx = 111320 * Math.cos(rad(p[0]));
    for (let i = 0; i < coords.length - 1; i++) {
      if (cum[i + 1] < (fromM || 0) - 1) continue;
      const ax = (coords[i][1] - p[1]) * kx, ay = (coords[i][0] - p[0]) * ky;
      const bx = (coords[i + 1][1] - p[1]) * kx, by = (coords[i + 1][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d - 0.01) best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    return best.along;
  }

  // ---------- instruction text and icons ----------
  const ORD = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const ICON = {
    straight: '↑', 'slight right': '↗', right: '↱', 'sharp right': '↘', uturn: '↶',
    'slight left': '↖', left: '↰', 'sharp left': '↙', roundabout: '⟳', arrive: '🏁', depart: '↑', ramp: '↗', merge: '⤨'
  };
  const CARDINAL = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const cardinal = (deg) => CARDINAL[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // OSRM step -> { text, icon } (wording follows the usual navigation phrasing)
  function osrmInstruction(step) {
    const m = step.maneuver || {};
    const type = m.type || 'turn', mod = m.modifier || 'straight';
    const name = step.name || step.ref || '';
    const onto = name ? ' onto ' + name : '';
    const side = /left/.test(mod) ? 'left' : /right/.test(mod) ? 'right' : '';
    const turnWord = mod === 'uturn' ? 'Make a U-turn' : mod === 'straight' ? 'Continue straight' : 'Turn ' + mod;
    let text, icon = ICON[mod] || '↑';
    switch (type) {
      case 'depart': text = isNum(m.bearing_after) ? 'Head ' + cardinal(m.bearing_after) + (name ? ' on ' + name : '') : 'Start' + (name ? ' on ' + name : ''); icon = ICON.depart; break;
      case 'arrive': text = 'You have arrived at your destination' + (side ? ', on the ' + side : ''); icon = ICON.arrive; break;
      case 'new name': text = 'Continue onto ' + (name || 'the road'); break;
      case 'continue': text = (mod === 'straight' ? 'Continue straight' : mod === 'uturn' ? 'Make a U-turn' : 'Continue ' + mod) + onto; break;
      case 'merge': text = 'Merge' + (side ? ' ' + side : '') + onto; icon = ICON.merge; break;
      case 'on ramp': text = 'Take the ramp' + (side ? ' on the ' + side : '') + onto; icon = ICON.ramp; break;
      case 'off ramp': text = 'Take the exit' + (side ? ' on the ' + side : '') + onto; icon = ICON.ramp; break;
      case 'fork': text = 'Keep ' + (side || 'straight') + ' at the fork' + onto; break;
      case 'end of road': text = 'At the end of the road, ' + turnWord.toLowerCase() + onto; break;
      case 'roundabout': case 'rotary':
        text = isNum(m.exit) ? 'At the roundabout, take the ' + ORD(m.exit) + ' exit' + onto : 'Enter the roundabout' + onto; icon = ICON.roundabout; break;
      case 'roundabout turn': text = 'At the roundabout, ' + turnWord.toLowerCase() + onto; icon = ICON.roundabout; break;
      case 'exit roundabout': case 'exit rotary': text = 'Exit the roundabout' + onto; icon = ICON.roundabout; break;
      default: text = turnWord + onto;
    }
    return { text, icon };
  }

  // TomTom maneuver code -> modifier + icon (guidance instructions, instructionsType=text)
  const TT = {
    STRAIGHT: 'straight', FOLLOW: 'straight', KEEP_LEFT: 'slight left', BEAR_LEFT: 'slight left', TURN_LEFT: 'left', SHARP_LEFT: 'sharp left',
    KEEP_RIGHT: 'slight right', BEAR_RIGHT: 'slight right', TURN_RIGHT: 'right', SHARP_RIGHT: 'sharp right',
    MAKE_UTURN: 'uturn', TRY_MAKE_UTURN: 'uturn', MOTORWAY_EXIT_LEFT: 'slight left', MOTORWAY_EXIT_RIGHT: 'slight right'
  };
  function tomtomStep(ins) {
    const code = String(ins.maneuver || '');
    let type = 'turn', modifier = TT[code] || 'straight', icon;
    if (/^ARRIVE/.test(code)) { type = 'arrive'; icon = ICON.arrive; modifier = /LEFT/.test(code) ? 'left' : /RIGHT/.test(code) ? 'right' : 'straight'; }
    else if (code === 'DEPART') { type = 'depart'; icon = ICON.depart; }
    else if (/^ROUNDABOUT/.test(code)) { type = 'roundabout'; icon = ICON.roundabout; }
    else if (/ENTER_(MOTORWAY|FREEWAY|HIGHWAY)|ENTRANCE_RAMP|TAKE_EXIT|MOTORWAY_EXIT/.test(code)) { type = 'ramp'; icon = ICON.ramp; }
    else icon = ICON[modifier] || '↑';
    const name = ins.street || (Array.isArray(ins.roadNumbers) ? ins.roadNumbers.join(', ') : '') || '';
    let text = typeof ins.message === 'string' && ins.message.trim() ? ins.message.trim() : '';
    if (!text) text = type === 'arrive' ? 'You have arrived at your destination' : (modifier === 'straight' ? 'Continue straight' : modifier === 'uturn' ? 'Make a U-turn' : 'Turn ' + modifier) + (name ? ' onto ' + name : '');
    return { type, modifier, icon, name, text, exit: isNum(ins.roundaboutExitNumber) ? ins.roundaboutExitNumber : null };
  }

  // ---------- normalisers ----------
  function finishRoute(r) {
    r.cum = cumulative(r.coords);
    r.lengthM = r.cum[r.cum.length - 1] || 0;
    if (!isNum(r.distanceM)) r.distanceM = r.lengthM;
    if (!r.steps.length || r.steps[r.steps.length - 1].type !== 'arrive') {
      r.steps.push({ alongM: r.lengthM, distanceM: 0, durationS: 0, type: 'arrive', modifier: 'straight', exit: null, name: '', text: 'You have arrived at your destination', icon: ICON.arrive, location: r.coords[r.coords.length - 1] });
    }
    // Step distances follow the geometry (difference of along positions).
    for (let i = 0; i < r.steps.length; i++) {
      const next = r.steps[i + 1];
      r.steps[i].alongM = Math.min(r.lengthM, Math.max(0, r.steps[i].alongM));
      r.steps[i].distanceM = next ? Math.max(0, next.alongM - r.steps[i].alongM) : 0;
    }
    return r;
  }

  // OSRM route object (geometries=geojson, steps=true) -> NavRoute
  function fromOsrm(route) {
    if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates)) return null;
    const coords = route.geometry.coordinates.filter((c) => isNum(c[0]) && isNum(c[1])).map((c) => [c[1], c[0]]);
    if (coords.length < 2) return null;
    const cum = cumulative(coords);
    const steps = [];
    let from = 0;
    for (const leg of route.legs || []) for (const s of leg.steps || []) {
      const loc = s.maneuver && Array.isArray(s.maneuver.location) ? [s.maneuver.location[1], s.maneuver.location[0]] : null;
      const along = loc ? alongOf(coords, cum, loc, from) : from;
      from = along;
      const t = osrmInstruction(s);
      const m = s.maneuver || {};
      // Intermediate "arrive" at via points is not the destination: say "waypoint".
      steps.push({ alongM: along, distanceM: s.distance || 0, durationS: isNum(s.duration) ? s.duration : 0, type: m.type || 'turn', modifier: m.modifier || 'straight',
        exit: isNum(m.exit) ? m.exit : null, name: s.name || s.ref || '', text: t.text, icon: t.icon, location: loc });
    }
    // Only the last arrive is the destination.
    for (let i = 0; i < steps.length - 1; i++) if (steps[i].type === 'arrive') { steps[i].type = 'waypoint'; steps[i].text = 'You have reached a stop on your route'; }
    return finishRoute({ provider: 'osrm', coords, steps, distanceM: route.distance, durationS: route.duration, trafficDelayS: null });
  }

  // TomTom route object (routeRepresentation=polyline, instructionsType=text) -> NavRoute
  function fromTomTom(route) {
    if (!route || !Array.isArray(route.legs)) return null;
    const coords = [];
    for (const leg of route.legs) for (const p of leg.points || []) if (isNum(p.latitude) && isNum(p.longitude)) coords.push([p.latitude, p.longitude]);
    if (coords.length < 2) return null;
    const s = route.summary || {};
    const ins = (route.guidance && Array.isArray(route.guidance.instructions)) ? route.guidance.instructions : [];
    const steps = [];
    const scale = isNum(s.lengthInMeters) && s.lengthInMeters > 0 ? null : 1;
    const cum = cumulative(coords);
    const k = scale || (cum[cum.length - 1] / s.lengthInMeters);
    for (let i = 0; i < ins.length; i++) {
      const a = ins[i], b = ins[i + 1];
      const t = tomtomStep(a);
      steps.push(Object.assign(t, {
        alongM: isNum(a.routeOffsetInMeters) ? a.routeOffsetInMeters * k : 0,
        durationS: b && isNum(b.travelTimeInSeconds) && isNum(a.travelTimeInSeconds) ? Math.max(0, b.travelTimeInSeconds - a.travelTimeInSeconds) : 0,
        distanceM: 0,
        location: a.point && isNum(a.point.latitude) ? [a.point.latitude, a.point.longitude] : null
      }));
    }
    return finishRoute({ provider: 'tomtom', coords, steps, distanceM: s.lengthInMeters, durationS: s.travelTimeInSeconds,
      trafficDelayS: isNum(s.trafficDelayInSeconds) ? s.trafficDelayInSeconds : null });
  }

  // Q-FLOW route from routing.js (keeps OSRM steps with maneuver data) -> NavRoute
  function fromQflowRoute(r) {
    if (!r || !r.geometry) return null;
    const legs = [{ steps: (r.steps || []).map((s) => ({ name: s.name === 'Road segment' ? '' : s.name, distance: s.distance, duration: s.duration, maneuver: s.maneuver || {} })) }];
    const nav = fromOsrm({ geometry: r.geometry, legs, distance: (r.distanceKm || 0) * 1000, duration: (r.durationMin || 0) * 60 });
    if (nav && r.timeSource === 'live') nav.durationS = r.durationMin * 60;
    return nav;
  }

  // ---------- providers ----------
  const fmt = (p) => (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6);

  function osrmProvider(deps) {
    return {
      name: 'osrm',
      available: () => true,
      async getRoutes(origin, dest, o) {
        const pts = [origin].concat(o.via || [], [dest]);
        let q = `overview=full&geometries=geojson&steps=true&alternatives=${o.alternatives && !(o.via || []).length ? 'true' : 'false'}`;
        // A known heading makes the route start in the direction of travel (no U-turn at the start).
        if (isNum(o.headingDeg)) q += '&bearings=' + Math.round(((o.headingDeg % 360) + 360) % 360) + ',60' + ';'.repeat(pts.length - 1);
        const url = `${deps.baseUrl()}/route/v1/${deps.profile ? deps.profile() : 'driving'}/${pts.map((p) => (+p.lng).toFixed(6) + ',' + (+p.lat).toFixed(6)).join(';')}?${q}`;
        const d = await deps.getJSON(url, { service: 'osrm', label: 'The route service (OSRM)', okStatuses: [400], silent: true });
        if (!d || d.code !== 'Ok' || !Array.isArray(d.routes)) {
          const e = new Error(d && d.message ? d.message : 'No route found'); e.kind = 'no-route'; throw e;
        }
        return d.routes.map(fromOsrm).filter(Boolean);
      }
    };
  }

  function tomtomProvider(deps) {
    return {
      name: 'tomtom',
      available: () => !!deps.key(),
      async getRoutes(origin, dest, o) {
        const key = deps.key();
        const pts = [origin].concat(o.via || [], [dest]);
        let q = `key=${encodeURIComponent(key)}&traffic=true&routeType=fastest&travelMode=${o.travelMode || 'car'}&departAt=now` +
          `&instructionsType=text&language=${o.language || 'en-GB'}&routeRepresentation=polyline&maxAlternatives=${o.alternatives ? 2 : 0}`;
        if (isNum(o.headingDeg)) q += '&vehicleHeading=' + Math.round(((o.headingDeg % 360) + 360) % 360);
        const url = `${deps.baseUrl()}/routing/1/calculateRoute/${pts.map(fmt).join(':')}/json?${q}`;
        const d = await deps.getJSON(url, { service: 'tomtom', label: 'TomTom routing', silent: true });
        const routes = (d && Array.isArray(d.routes) ? d.routes : []).map(fromTomTom).filter(Boolean);
        if (!routes.length) { const e = new Error('No route found'); e.kind = 'no-route'; throw e; }
        return routes;
      }
    };
  }

  // providers: in order of preference. getRoute tries each available provider until one answers.
  function createRoutingService(providers) {
    return {
      providers,
      async getRoute(origin, destination, options) {
        const o = options || {};
        if (!origin || !destination || !isNum(+origin.lat) || !isNum(+destination.lat)) throw Object.assign(new Error('Origin and destination are required.'), { kind: 'bad-input' });
        let lastErr = null;
        for (const p of providers) {
          if (!p.available()) continue;
          try {
            const routes = await p.getRoutes(origin, destination, o);
            if (routes.length) return { routes, provider: p.name };
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            lastErr = e;
          }
        }
        throw lastErr || Object.assign(new Error('No routing service is available.'), { kind: 'no-provider' });
      }
    };
  }

  return { haversineM, cumulative, alongOf, osrmInstruction, tomtomStep, fromOsrm, fromTomTom, fromQflowRoute, osrmProvider, tomtomProvider, createRoutingService, cardinal };
});

/* ---------- browser glue: the app's RoutingService ----------
   TomTom first when live traffic is on (key set, not paused): traffic-aware routes with
   guidance. OSRM otherwise, or when TomTom fails. */
const qflowRoutingService = (typeof qflowNet !== 'undefined' && typeof QFLOW_CONFIG !== 'undefined')
  ? QFlowNavRouting.createRoutingService([
    QFlowNavRouting.tomtomProvider({
      key: () => (typeof qflowLive !== 'undefined' && qflowLive && qflowLive.enabled() && typeof qflowLiveKey === 'function' ? qflowLiveKey() : null),
      baseUrl: () => QFLOW_CONFIG.tomtomBaseUrl || 'https://api.tomtom.com',
      getJSON: (u, o) => qflowNet.getJSON(u, o)
    }),
    QFlowNavRouting.osrmProvider({
      baseUrl: () => QFLOW_CONFIG.osrmBaseUrl,
      profile: () => QFLOW_CONFIG.osrmProfile || 'driving',
      getJSON: (u, o) => qflowNet.getJSON(u, o)
    })
  ])
  : null;
