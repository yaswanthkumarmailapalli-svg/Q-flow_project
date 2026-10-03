// Live traffic (src/traffic-live.js) with mocked TomTom responses. No network, no key.
// Response shapes follow TomTom's documentation (Incident Details v5, Calculate Route,
// Matrix Routing v2); these tests cannot prove the live service behaves the same.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const T = require(path.join(SRC, 'traffic-live.js'));

(async () => {
  console.log('--- Live traffic (TomTom), mocked ---');
  const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const BASE = 'https://api.tomtom.com';

  // Keys and URLs
  assert.ok(T.validKey(KEY) && !T.validKey('short') && !T.validKey('has spaces in it 1234567890') && !T.validKey(''));
  assert.strictEqual(T.flowTileUrl(BASE, KEY, 'relative0'), `${BASE}/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${KEY}&tileSize=256`);
  const bb = T.bboxAround(17.385, 78.4867, 10);
  assert.ok(bb[0] < 78.4867 && bb[2] > 78.4867 && bb[1] < 17.385 && bb[3] > 17.385, 'bbox is minLon,minLat,maxLon,maxLat');
  const areaKm2 = (b) => ((b[2] - b[0]) * 111.32 * Math.cos((17.385 * Math.PI) / 180)) * ((b[3] - b[1]) * 111.32);
  assert.ok(areaKm2(T.bboxAround(17.385, 78.4867, 500)) <= 10000, 'incident bbox kept within TomTom\'s 10,000 km² limit');
  const iu = T.incidentsUrl(BASE, KEY, bb);
  assert.ok(iu.startsWith(`${BASE}/traffic/services/5/incidentDetails?key=`) && /timeValidityFilter=present/.test(iu) && /magnitudeOfDelay/.test(decodeURIComponent(iu)));
  const ru = T.routeUrl(BASE, KEY, [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
  assert.ok(ru.includes('/routing/1/calculateRoute/1.000000,2.000000:3.000000,4.000000/json?') && /traffic=true/.test(ru) && /computeTravelTimeFor=all/.test(ru));

  // Incidents (documented example: road closure = iconCategory 8, magnitudeOfDelay 4)
  const incJson = { incidents: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [78.49, 17.39] }, properties: { iconCategory: 6, magnitudeOfDelay: 2, delay: 300, from: 'A Rd', to: 'B Rd', events: [{ description: 'Stationary traffic', code: 101 }] } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[78.40, 17.30], [78.41, 17.31], [78.42, 17.32]] }, properties: { iconCategory: 8, magnitudeOfDelay: 4, roadNumbers: ['NH65'], events: [{ description: 'Closed' }] } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: ['bad'] }, properties: { iconCategory: 1 } },
    null
  ] };
  const inc = T.parseIncidents(incJson);
  assert.strictEqual(inc.length, 2, 'malformed incidents skipped');
  assert.strictEqual(inc[0].category, 'Road closed', 'closures sorted first');
  assert.deepStrictEqual([inc[0].lat, inc[0].lng], [17.31, 78.41], 'midpoint of the line, as lat/lng');
  assert.strictEqual(inc[0].road, 'NH65');
  assert.strictEqual(inc[1].delayMin, 5);
  assert.strictEqual(inc[1].description, 'Stationary traffic');
  assert.deepStrictEqual(T.parseIncidents({}), []);

  // Route summary (documented example: travel 161 s, delay 15 s, no-traffic 120 s)
  const rs = T.parseRouteSummary({ routes: [{ summary: { lengthInMeters: 1147, travelTimeInSeconds: 161, trafficDelayInSeconds: 15, noTrafficTravelTimeInSeconds: 120 } }] });
  assert.ok(Math.abs(rs.travelMin - 161 / 60) < 1e-9 && Math.abs(rs.delayMin - 41 / 60) < 1e-9 && Math.abs(rs.incidentDelayMin - 0.25) < 1e-9);
  assert.strictEqual(T.parseRouteSummary({ routes: [] }), null);
  assert.strictEqual(T.viaPoints([[0, 0], [1, 1]], 2).length, 0);
  assert.deepStrictEqual(T.viaPoints([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], 2), [{ lat: 2, lng: 2 }, { lat: 4, lng: 4 }]);

  // Matrix blocks: <= 100 cells each, every cell exactly once
  for (const n of [2, 9, 10, 11, 16]) {
    const seen = new Set();
    for (const b of T.matrixBlocks(n)) {
      assert.ok((b.o[1] - b.o[0]) * (b.d[1] - b.d[0]) <= 100, 'block within 100 cells');
      for (let i = b.o[0]; i < b.o[1]; i++) for (let j = b.d[0]; j < b.d[1]; j++) { assert.ok(!seen.has(i + ',' + j)); seen.add(i + ',' + j); }
    }
    assert.strictEqual(seen.size, n * n);
  }
  const body = T.matrixBody([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], { o: [0, 2], d: [0, 1] });
  assert.deepStrictEqual(body.options, { departAt: 'now', traffic: 'live', routeType: 'fastest', travelMode: 'car' });
  assert.deepStrictEqual(body.destinations, [{ point: { latitude: 1, longitude: 2 } }]);

  // Client with a mocked getJSON
  const nodes = [{ lat: 17.38, lng: 78.48 }, { lat: 17.40, lng: 78.50 }, { lat: 17.36, lng: 78.45 }];
  const fallback = { dist: nodes.map(() => [9, 9, 9]), time: nodes.map(() => [99, 99, 99]) };
  const mk = (handler, key = KEY) => {
    const calls = [], msgs = [];
    const c = T.createClient({ baseUrl: BASE, key: () => key, onFailure: (m) => msgs.push(m), getJSON: async (url, o) => { calls.push({ url, o }); return handler(url, o, calls.length); } });
    return { c, calls, msgs };
  };
  {
    const { c, calls } = mk(() => { throw new Error('should not be called'); }, null);
    assert.strictEqual(c.enabled(), false);
    assert.strictEqual(await c.incidents(17, 78), null);
    assert.strictEqual(await c.matrix(nodes, fallback), null);
    assert.strictEqual(c.tileUrl(), null);
    assert.strictEqual(calls.length, 0, 'no key: no requests at all');
  }
  {
    const { c, calls } = mk((url, o) => {
      const b = JSON.parse(o.body);
      const data = [];
      b.origins.forEach((_, oi) => b.destinations.forEach((__, di) => {
        if (oi === 0 && di === 2) data.push({ originIndex: oi, destinationIndex: di, detailedError: { code: 'NO_ROUTE_FOUND' } });
        else data.push({ originIndex: oi, destinationIndex: di, routeSummary: { lengthInMeters: 1000 * (oi + di + 1), travelTimeInSeconds: 60 * (oi + di + 2), trafficDelayInSeconds: 60 } });
      }));
      return { data };
    });
    const res = await c.matrix(nodes, fallback);
    assert.strictEqual(calls.length, 1, '3 x 3 = 9 cells: one request');
    assert.strictEqual(calls[0].o.method, 'POST');
    assert.ok(!calls[0].o.cacheKey.includes(KEY), 'API key is not part of the cache key');
    const m = res.matrix;
    assert.strictEqual(m.traffic.source, 'live');
    assert.strictEqual(m.traffic.failedCells, 1);
    assert.strictEqual(m.dist[1][2], 4, 'road distance in km');
    assert.strictEqual(m.time[1][2], 5, 'live minutes');
    assert.strictEqual(res.freeMatrix.time[1][2], 4, 'free-flow = live - traffic delay');
    assert.strictEqual(m.time[0][2], 99, 'failed cell uses the simulated fallback');
    assert.strictEqual(m.time[1][1], 0);
    // The engine accepts the live matrix.
    const V = require(path.join(SRC, 'vrp-engine.js'));
    const vn = nodes.map((n, i) => ({ ...n, demand: i ? 5 : 0, readyTime: 0, dueTime: i ? 600 : 1440, serviceTime: i ? 5 : 0 }));
    const r = V.runClarkeWright(vn, m, 50, 2);
    assert.ok(Number.isFinite(r.bestCost));
  }
  {
    const n17 = Array.from({ length: 17 }, (_, i) => ({ lat: 17 + i / 100, lng: 78 }));
    const { c, calls } = mk(() => ({ data: [] }));
    assert.strictEqual(await c.matrix(n17, fallback), null, 'more than 16 points: refused');
    assert.strictEqual(calls.length, 0);
  }
  {
    // 403: key rejected -> paused, message, no further requests
    const { c, calls, msgs } = mk(() => { const e = new Error('x'); e.kind = 'http'; e.status = 403; throw e; });
    assert.strictEqual(await c.incidents(17.38, 78.48, 5), null);
    assert.ok(/key was rejected/.test(msgs[0]) && /simulated/.test(msgs[0]));
    assert.strictEqual(c.enabled(), false);
    assert.strictEqual(await c.routeTime([[78, 17], [78.1, 17.1]]), null);
    assert.strictEqual(calls.length, 1, 'paused after a rejected key');
    c.resume(); assert.strictEqual(c.enabled(), true);
  }
  {
    const { msgs, c } = mk(() => { const e = new Error('x'); e.kind = 'rate-limit'; e.status = 429; throw e; });
    await c.routeTime([[78, 17], [78.05, 17.05], [78.1, 17.1]]);
    assert.ok(/limit reached/.test(msgs[0]));
  }
  {
    const { c, calls } = mk(() => incJson);
    const list = await c.incidents(17.38, 78.48, 10);
    assert.strictEqual(list.length, 2);
    assert.ok(!calls[0].o.cacheKey.includes(KEY) && calls[0].o.silent === true);
  }

  // Routing: live times replace OSRM times only when every route got one.
  function routingCtx(liveFn) {
    const ctx = { console, Promise, Math, Number, Object, Array, JSON, isFinite, parseFloat,
      QFlowEmissions: { gPerKm: () => 120 }, qflowCssVar: () => '#808080', document: { getElementById: () => null },
      qflowLive: { enabled: () => true, routeTime: liveFn } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'routing.js'), 'utf8'), ctx);
    return ctx;
  }
  const routes = () => [
    { id: 'A', durationMin: 20, baseDurationMin: 20, distanceKm: 10, signals: 3, co2Grams: 900, geometry: { coordinates: [[78, 17], [78.05, 17.05], [78.1, 17.1]] } },
    { id: 'B', durationMin: 22, baseDurationMin: 22, distanceKm: 9, signals: 5, co2Grams: 950, geometry: { coordinates: [[78, 17], [78.02, 17.07], [78.1, 17.1]] } }
  ];
  {
    const ctx = routingCtx(async (coords) => ({ travelMin: coords[1][1] === 17.05 ? 35 : 25, freeFlowMin: 18, delayMin: coords[1][1] === 17.05 ? 17 : 7, incidentDelayMin: 2 }));
    const rr = routes();
    await ctx.qflowApplyLiveTimes(rr, vm.runInContext("VEHICLE_PROFILES.car", ctx));
    assert.deepStrictEqual(rr.map((r) => [r.durationMin, r.timeSource, r.osrmDurationMin, r.liveDelayMin]), [[35, 'live', 20, 17], [25, 'live', 22, 7]]);
    assert.strictEqual(rr[1].tag, 'Fastest Corridor (Min Time)', 'tags follow the live times');
    assert.strictEqual(ctx.qflowRouteSourceLabel(rr).live, true);
  }
  {
    const ctx = routingCtx(async (coords) => (coords[1][1] === 17.05 ? { travelMin: 35, freeFlowMin: 18, delayMin: 17, incidentDelayMin: 2 } : null));
    const rr = routes();
    await ctx.qflowApplyLiveTimes(rr, vm.runInContext("VEHICLE_PROFILES.car", ctx));
    assert.deepStrictEqual(rr.map((r) => [r.durationMin, r.timeSource]), [[20, 'osrm'], [22, 'osrm']], 'mixed sources: all keep OSRM times');
    assert.ok(/NO LIVE TRAFFIC/.test(ctx.qflowRouteSourceLabel(rr).text));
  }

  // No keys in the source; the key reaches www/ only from the environment at build time.
  const keyLike = /['"`][A-Za-z0-9]{32}['"`]/;
  for (const f of fs.readdirSync(SRC)) assert.ok(!keyLike.test(fs.readFileSync(path.join(SRC, f), 'utf8')), `no API-key-like literal in src/${f}`);
  assert.ok(/tomtomKey: ''/.test(fs.readFileSync(path.join(SRC, 'config.js'), 'utf8')));
  assert.ok(/process\.env\.QFLOW_TOMTOM_KEY/.test(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-www.js'), 'utf8')));

  console.log('✓ TomTom URLs, incidents, route summaries and matrix blocks (<= 100 cells) parsed; no key = no requests; rejected key / quota pause with a message; failed cells fall back; mixed route sources never compared; no keys in src/.');
})().catch((e) => { console.error(e); process.exit(1); });
