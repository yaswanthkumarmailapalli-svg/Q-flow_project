/* =========================================================
   Q-FLOW — LIVE TRAFFIC (TomTom), optional
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: config.js (qflowNet, QFLOW_CONFIG, qflowStatus) at call time.

   Live traffic is used ONLY when a TomTom API key is configured (README "Live
   traffic"). Without a key, or when a request fails, every page keeps its
   simulated traffic and its "simulated" labels. Pages switch a label to "live"
   only after a live response has actually arrived.

   TomTom APIs used (developer.tomtom.com):
   - Traffic Flow raster tiles  /traffic/map/4/tile/flow/{style}/{z}/{x}/{y}.png   (tile request)
   - Incident Details v5        /traffic/services/5/incidentDetails                (non-tile)
   - Calculate Route            /routing/1/calculateRoute/{points}/json?traffic=true (non-tile)
   - Matrix Routing v2 (sync)   POST /routing/matrix/2, traffic "live"             (non-tile; max 100 cells per request here)
   Free tier (at the time of writing): 50,000 tile + 2,500 non-tile requests per day.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowLive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const MAX_MATRIX_NODES = 16;   // depot + 15 stops = 256 cells (3-4 requests)
  const MAX_CELLS_PER_REQUEST = 100; // TomTom: up to 100 cells with no extra restrictions
  const MAX_INCIDENT_BBOX_KM2 = 10000;

  // TomTom incident iconCategory codes (Incident Details v5).
  const INCIDENT_CATEGORY = {
    0: 'Unknown', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Jam',
    7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 13: 'Several incidents', 14: 'Broken-down vehicle'
  };
  const INCIDENT_ICON = { 1: '💥', 6: '🚗', 7: '🚧', 8: '⛔', 9: '🚧', 14: '🛻', 4: '🌧️', 11: '🌊', 2: '🌫️', 5: '🧊' };
  // magnitudeOfDelay: 0 unknown, 1 minor, 2 moderate, 3 major, 4 undefined (closures etc.)
  const MAGNITUDE = { 0: 'Unknown delay', 1: 'Minor delay', 2: 'Moderate delay', 3: 'Major delay', 4: 'Closed / indefinite' };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const validKey = (k) => typeof k === 'string' && KEY_RE.test(k.trim());

  function flowTileUrl(baseUrl, key, style) {
    return `${baseUrl}/traffic/map/4/tile/flow/${style || 'relative0'}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256`;
  }

  // Bounding box of +-radiusKm around a point, shrunk if needed to TomTom's area limit.
  function bboxAround(lat, lng, radiusKm) {
    let r = Math.max(0.5, radiusKm || 8);
    const maxR = Math.sqrt(MAX_INCIDENT_BBOX_KM2) / 2 - 0.5;
    r = Math.min(r, maxR);
    const dLat = r / 111.32;
    const dLng = r / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
  }

  function incidentsUrl(baseUrl, key, bbox) {
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
    return `${baseUrl}/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}&bbox=${bbox.map((v) => v.toFixed(5)).join(',')}` +
      `&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present`;
  }

  // -> [{ id, category, categoryCode, icon, magnitude, magnitudeCode, delayMin, lengthKm, from, to, road, description, lat, lng, line }]
  function parseIncidents(json) {
    const list = (json && Array.isArray(json.incidents)) ? json.incidents : [];
    const out = [];
    for (const f of list) {
      const p = (f && f.properties) || {};
      const g = (f && f.geometry) || {};
      let coords = [];
      if (g.type === 'Point' && Array.isArray(g.coordinates)) coords = [g.coordinates];
      else if (g.type === 'LineString' && Array.isArray(g.coordinates)) coords = g.coordinates;
      coords = coords.filter((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1]));
      if (!coords.length) continue;
      const mid = coords[Math.floor(coords.length / 2)];
      const code = isNum(p.iconCategory) ? p.iconCategory : 0;
      const mag = isNum(p.magnitudeOfDelay) ? p.magnitudeOfDelay : 0;
      const ev = Array.isArray(p.events) && p.events[0] ? p.events[0] : null;
      out.push({
        id: p.id || null,
        categoryCode: code,
        category: INCIDENT_CATEGORY[code] || 'Incident',
        icon: INCIDENT_ICON[code] || '⚠️',
        magnitudeCode: mag,
        magnitude: MAGNITUDE[mag] || 'Unknown delay',
        delayMin: isNum(p.delay) ? Math.round(p.delay / 60) : null,
        lengthKm: isNum(p.length) ? Math.round(p.length / 100) / 10 : null,
        from: typeof p.from === 'string' ? p.from : '',
        to: typeof p.to === 'string' ? p.to : '',
        road: Array.isArray(p.roadNumbers) ? p.roadNumbers.filter((x) => typeof x === 'string').join(', ') : '',
        description: ev && typeof ev.description === 'string' ? ev.description : '',
        lat: mid[1],
        lng: mid[0],
        line: coords.map((c) => [c[1], c[0]])
      });
    }
    // Most serious first: closures and major delays, then longest delay.
    out.sort((a, b) => (b.magnitudeCode % 5) - (a.magnitudeCode % 5) || (b.delayMin || 0) - (a.delayMin || 0));
    return out;
  }

  // Calculate Route through a few points of a known route, with live traffic.
  function routeUrl(baseUrl, key, points, travelMode) {
    const loc = points.map((p) => (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6)).join(':');
    return `${baseUrl}/routing/1/calculateRoute/${loc}/json?key=${encodeURIComponent(key)}` +
      `&traffic=true&computeTravelTimeFor=all&routeRepresentation=summaryOnly&routeType=fastest&departAt=now&travelMode=${travelMode || 'car'}`;
  }

  // Up to `count` evenly spaced interior points of a GeoJSON LineString ([lng, lat] pairs),
  // so the live route follows the same corridor as the OSRM route.
  function viaPoints(coordinates, count) {
    const c = Array.isArray(coordinates) ? coordinates : [];
    if (c.length < 3) return [];
    const out = [];
    for (let k = 1; k <= count; k++) {
      const p = c[Math.floor((c.length - 1) * k / (count + 1))];
      if (p && isNum(p[0]) && isNum(p[1])) out.push({ lat: p[1], lng: p[0] });
    }
    return out;
  }

  // -> { travelMin, freeFlowMin, delayMin, incidentDelayMin, lengthKm } or null
  function parseRouteSummary(json) {
    const s = json && Array.isArray(json.routes) && json.routes[0] && json.routes[0].summary;
    if (!s || !isNum(s.travelTimeInSeconds)) return null;
    const travel = s.travelTimeInSeconds;
    const free = isNum(s.noTrafficTravelTimeInSeconds) ? s.noTrafficTravelTimeInSeconds : null;
    return {
      travelMin: travel / 60,
      freeFlowMin: free === null ? null : free / 60,
      // Total cost of congestion = live time - no-traffic time (TomTom's trafficDelayInSeconds
      // only covers live incidents/jams, so it is reported separately).
      delayMin: free === null ? null : Math.max(0, (travel - free) / 60),
      incidentDelayMin: isNum(s.trafficDelayInSeconds) ? s.trafficDelayInSeconds / 60 : null,
      lengthKm: isNum(s.lengthInMeters) ? s.lengthInMeters / 1000 : null
    };
  }

  // Splits an n x n matrix into blocks of at most maxCells cells: [{ o: [i0, i1), d: [j0, j1) }].
  function matrixBlocks(n, maxCells) {
    const max = maxCells || MAX_CELLS_PER_REQUEST;
    const side = Math.max(1, Math.floor(Math.sqrt(max)));
    const blocks = [];
    for (let i = 0; i < n; i += side) for (let j = 0; j < n; j += side) blocks.push({ o: [i, Math.min(n, i + side)], d: [j, Math.min(n, j + side)] });
    return blocks;
  }

  function matrixBody(nodes, block) {
    const pt = (n) => ({ point: { latitude: +n.lat, longitude: +n.lng } });
    return {
      origins: nodes.slice(block.o[0], block.o[1]).map(pt),
      destinations: nodes.slice(block.d[0], block.d[1]).map(pt),
      options: { departAt: 'now', traffic: 'live', routeType: 'fastest', travelMode: 'car' }
    };
  }

  // Fills cells[i][j] = { km, min, freeMin } from one block's response; returns the number of failed cells.
  function applyMatrixBlock(cells, json, block) {
    let failed = 0;
    const data = json && Array.isArray(json.data) ? json.data : [];
    const want = (block.o[1] - block.o[0]) * (block.d[1] - block.d[0]);
    let got = 0;
    for (const c of data) {
      const i = block.o[0] + c.originIndex, j = block.d[0] + c.destinationIndex;
      const s = c.routeSummary;
      if (!cells[i] || !(j in cells[i])) continue;
      if (s && isNum(s.travelTimeInSeconds) && isNum(s.lengthInMeters)) {
        const delay = isNum(s.trafficDelayInSeconds) ? s.trafficDelayInSeconds : 0;
        cells[i][j] = { km: s.lengthInMeters / 1000, min: s.travelTimeInSeconds / 60, freeMin: Math.max(0, s.travelTimeInSeconds - delay) / 60 };
        got++;
      } else failed++;
    }
    return failed + Math.max(0, want - got - failed);
  }

  // A live cost matrix in the engine's format ({ dist, time, traffic }); cells that failed
  // use the fallback (simulated) matrix and are counted in traffic.failedCells.
  function toCostMatrix(cells, fallback, meta) {
    const n = cells.length;
    const dist = [], time = [], free = [];
    let failed = 0;
    for (let i = 0; i < n; i++) {
      dist[i] = new Float64Array(n); time[i] = new Float64Array(n); free[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const c = cells[i][j];
        if (c) { dist[i][j] = c.km; time[i][j] = c.min; free[i][j] = c.freeMin; }
        else { failed++; dist[i][j] = fallback.dist[i][j]; time[i][j] = fallback.time[i][j]; free[i][j] = fallback.time[i][j]; }
      }
    }
    const traffic = Object.assign({
      source: 'live',
      provider: 'TomTom',
      network: 'TomTom road network (real road distances)',
      failedCells: failed
    }, meta || {});
    return { matrix: { dist, time, traffic }, freeMatrix: { dist, time: free, traffic: Object.assign({}, traffic, { freeFlow: true }) } };
  }

  // Maps a request failure to a short message and whether live traffic should pause.
  function describeFailure(err) {
    const st = err && err.status;
    if (st === 401 || st === 403) return { pause: true, message: 'The TomTom API key was rejected. Check the key in Appearance > Live traffic. Showing simulated traffic.' };
    if (st === 429 || (err && err.kind === 'rate-limit')) return { pause: true, message: 'TomTom live-traffic limit reached for today. Showing simulated traffic.' };
    if (err && err.kind === 'offline') return { pause: false, message: 'No internet: showing simulated traffic.' };
    return { pause: false, message: 'Live traffic (TomTom) is unavailable right now. Showing simulated traffic.' };
  }

  // ---------- client (requests via an injected getJSON, so tests can mock it) ----------
  // deps: { getJSON(url, opts), key: () => string|null, baseUrl, ttl: { incidents, route, matrix }, onFailure(msg) }
  function createClient(deps) {
    const ttl = Object.assign({ incidents: 120e3, route: 120e3, matrix: 300e3 }, deps.ttl || {});
    let paused = false;
    const key = () => (paused ? null : deps.key());
    const fail = (err) => {
      const f = describeFailure(err);
      if (f.pause) paused = true;
      if (deps.onFailure) deps.onFailure(f.message, err);
      return null;
    };
    const opts = (cacheKey, ttlMs, extra) => Object.assign({ service: 'tomtom', label: 'Live traffic (TomTom)', ttlMs, cacheKey, silent: true }, extra || {});

    return {
      enabled: () => !!key(),
      tileUrl: (style) => (key() ? flowTileUrl(deps.baseUrl, key(), style) : null),

      async incidents(lat, lng, radiusKm) {
        const k = key();
        if (!k || !isNum(lat) || !isNum(lng)) return null;
        const bbox = bboxAround(lat, lng, radiusKm);
        const ck = 'tomtom:incidents:' + bbox.map((v) => v.toFixed(3)).join(',');
        try {
          return parseIncidents(await deps.getJSON(incidentsUrl(deps.baseUrl, k, bbox), opts(ck, ttl.incidents, { cacheIf: (j) => !!(j && j.incidents) })));
        } catch (e) { return fail(e); }
      },

      // Live travel time along a route given by its GeoJSON coordinates (start and end included).
      async routeTime(coordinates, travelMode) {
        const k = key();
        if (!k || !Array.isArray(coordinates) || coordinates.length < 2) return null;
        const first = coordinates[0], last = coordinates[coordinates.length - 1];
        const pts = [{ lat: first[1], lng: first[0] }].concat(viaPoints(coordinates, 2), [{ lat: last[1], lng: last[0] }]);
        const ck = 'tomtom:route:' + (travelMode || 'car') + ':' + pts.map((p) => p.lat.toFixed(4) + ',' + p.lng.toFixed(4)).join(':');
        try {
          return parseRouteSummary(await deps.getJSON(routeUrl(deps.baseUrl, k, pts, travelMode), opts(ck, ttl.route, { cacheIf: (j) => !!(j && j.routes) })));
        } catch (e) { return fail(e); }
      },

      // Live n x n travel matrix for the fleet optimiser. Returns { matrix, freeMatrix, requests } or null.
      async matrix(nodes, fallback) {
        const k = key();
        if (!k || !Array.isArray(nodes) || nodes.length < 2) return null;
        if (nodes.length > MAX_MATRIX_NODES) return null;
        const n = nodes.length;
        const cells = Array.from({ length: n }, () => {
          const row = {};
          for (let j = 0; j < n; j++) row[j] = null;
          return row;
        });
        const blocks = matrixBlocks(n);
        const sig = nodes.map((p) => (+p.lat).toFixed(5) + ',' + (+p.lng).toFixed(5)).join(';');
        try {
          for (const b of blocks) {
            const body = matrixBody(nodes, b);
            const ck = 'tomtom:matrix:' + sig + ':' + b.o.join('-') + ':' + b.d.join('-');
            const json = await deps.getJSON(`${deps.baseUrl}/routing/matrix/2?key=${encodeURIComponent(k)}`, opts(ck, ttl.matrix, {
              method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
              cacheIf: (j) => !!(j && Array.isArray(j.data))
            }));
            applyMatrixBlock(cells, json, b);
          }
        } catch (e) { return fail(e); }
        const rows = Array.from({ length: n }, (_, i) => cells[i]);
        const out = toCostMatrix(rows, fallback, { fetchedAt: new Date().toISOString(), requests: blocks.length, cellsRequested: n * n });
        if (out.matrix.traffic.failedCells >= n * (n - 1)) return fail({ kind: 'bad-response' });
        return Object.assign(out, { requests: blocks.length });
      },

      resume() { paused = false; }
    };
  }

  return {
    KEY_RE, MAX_MATRIX_NODES, MAX_CELLS_PER_REQUEST, INCIDENT_CATEGORY,
    validKey, flowTileUrl, bboxAround, incidentsUrl, parseIncidents, routeUrl, viaPoints, parseRouteSummary,
    matrixBlocks, matrixBody, applyMatrixBlock, toCostMatrix, describeFailure, createClient
  };
});

/* ---------- browser glue: key storage and the shared client ---------- */
const QFLOW_LIVE_KEY_STORAGE = 'qflowTomTomKey';
const QFLOW_LIVE_OFF_STORAGE = 'qflowLiveOff';

// Key from src/local-config.js (QFLOW_CONFIG.tomtomKey) or entered in Appearance > Live traffic.
function qflowLiveKey() {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(QFLOW_LIVE_KEY_STORAGE) : null;
    const k = (stored || (typeof QFLOW_CONFIG !== 'undefined' && QFLOW_CONFIG.tomtomKey) || '').trim();
    return QFlowLive.validKey(k) ? k : null;
  } catch (e) { return null; }
}

// Live traffic is on when a key exists and the user has not switched it off.
function qflowLiveEnabled() {
  try { return !!qflowLiveKey() && localStorage.getItem(QFLOW_LIVE_OFF_STORAGE) !== '1'; } catch (e) { return false; }
}

function qflowSetLiveKey(k) {
  if (k && !QFlowLive.validKey(k)) return false;
  if (k) localStorage.setItem(QFLOW_LIVE_KEY_STORAGE, k.trim()); else localStorage.removeItem(QFLOW_LIVE_KEY_STORAGE);
  if (typeof qflowLive !== 'undefined' && qflowLive) qflowLive.resume();
  return true;
}

function qflowSetLiveOn(on) {
  if (on) localStorage.removeItem(QFLOW_LIVE_OFF_STORAGE); else localStorage.setItem(QFLOW_LIVE_OFF_STORAGE, '1');
}

const qflowLive = (typeof qflowNet !== 'undefined')
  ? QFlowLive.createClient({
    getJSON: (url, o) => qflowNet.getJSON(url, o),
    key: () => (qflowLiveEnabled() ? qflowLiveKey() : null),
    baseUrl: (typeof QFLOW_CONFIG !== 'undefined' && QFLOW_CONFIG.tomtomBaseUrl) || 'https://api.tomtom.com',
    ttl: typeof QFLOW_CONFIG !== 'undefined' && QFLOW_CONFIG.cacheTtlMs ? QFLOW_CONFIG.cacheTtlMs.live : undefined,
    onFailure: (msg) => { if (typeof qflowStatus !== 'undefined') qflowStatus.service(msg); }
  })
  : null;
