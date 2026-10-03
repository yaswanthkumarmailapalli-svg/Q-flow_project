// Navigation core (src/nav-routing.js, nav-progress.js, nav-controller.js) driven by
// recorded-style GPS traces. TEST-ONLY: the mock GPS below exists only in this file; the
// app's navigation screen uses the device's real location (src/nav-location.js).
const assert = require('assert');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const NR = require(path.join(SRC, 'nav-routing.js'));
const P = require(path.join(SRC, 'nav-progress.js'));
const NC = require(path.join(SRC, 'nav-controller.js'));

// ---------- test fixtures ----------
// An L-shaped road in Hyderabad: 1.2 km east along "Station Road", left turn, 0.8 km north
// along "Lake View Road" to the destination. Shaped like an OSRM response (geojson, steps).
const O = [17.3850, 78.4867];
const mPerDegLat = 110540, mPerDegLng = 111320 * Math.cos(17.39 * Math.PI / 180);
const at = (eastM, northM) => [O[0] + northM / mPerDegLat, O[1] + eastM / mPerDegLng];
const geo = [];
for (let e = 0; e <= 1200; e += 50) geo.push(at(e, 0));
for (let n = 50; n <= 800; n += 50) geo.push(at(1200, n));
const lnglat = (p) => [p[1], p[0]];
const OSRM_ROUTE = {
  distance: 2000, duration: 240,
  geometry: { type: 'LineString', coordinates: geo.map(lnglat) },
  legs: [{ steps: [
    { name: 'Station Road', distance: 1200, duration: 140, maneuver: { type: 'depart', bearing_after: 90, location: lnglat(at(0, 0)) } },
    { name: 'Lake View Road', distance: 800, duration: 100, maneuver: { type: 'turn', modifier: 'left', location: lnglat(at(1200, 0)) } },
    { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', modifier: 'right', location: lnglat(at(1200, 800)) } }
  ] }]
};
const DEST = { lat: at(1200, 800)[0], lng: at(1200, 800)[1], label: 'Lake View' };

// Deterministic noise (no Math.random), metres.
let seed = 7;
const noise = (amp) => { seed = (seed * 1103515245 + 12345) % 2147483648; return ((seed / 2147483648) * 2 - 1) * amp; };
const fixAt = (eastM, northM, t, o) => {
  const p = at(eastM + noise((o && o.noise) || 0), northM + noise((o && o.noise) || 0));
  return Object.assign({ lat: p[0], lng: p[1], accuracy: 8, heading: null, speed: 12, timestamp: t }, o || {});
};

(async () => {
  console.log('--- Navigation core (real-location pipeline, mocked GPS traces) ---');

  // ---------- RoutingService: normalisation ----------
  const r = NR.fromOsrm(OSRM_ROUTE);
  assert.strictEqual(r.provider, 'osrm');
  assert.ok(Math.abs(r.lengthM - 2000) < 5, 'route length from geometry: ' + r.lengthM);
  assert.deepStrictEqual(r.steps.map((s) => s.type), ['depart', 'turn', 'arrive']);
  assert.ok(Math.abs(r.steps[1].alongM - 1200) < 2, 'turn located on the route at 1.2 km');
  assert.strictEqual(r.steps[0].text, 'Head east on Station Road');
  assert.strictEqual(r.steps[1].text, 'Turn left onto Lake View Road');
  assert.strictEqual(r.steps[2].text, 'You have arrived at your destination, on the right');
  assert.strictEqual(r.steps[1].icon, '↰');
  assert.strictEqual(NR.osrmInstruction({ name: 'MG Road', maneuver: { type: 'roundabout', exit: 2 } }).text, 'At the roundabout, take the 2nd exit onto MG Road');
  assert.strictEqual(NR.osrmInstruction({ name: '', maneuver: { type: 'fork', modifier: 'slight right' } }).text, 'Keep right at the fork');

  // TomTom guidance (documented fields: routeOffsetInMeters, travelTimeInSeconds, point, maneuver, message, street)
  const tt = NR.fromTomTom({
    summary: { lengthInMeters: 2000, travelTimeInSeconds: 300, trafficDelayInSeconds: 45 },
    legs: [{ points: geo.map((p) => ({ latitude: p[0], longitude: p[1] })) }],
    guidance: { instructions: [
      { routeOffsetInMeters: 0, travelTimeInSeconds: 0, point: { latitude: geo[0][0], longitude: geo[0][1] }, maneuver: 'DEPART', message: 'Leave from Station Road', street: 'Station Road' },
      { routeOffsetInMeters: 1200, travelTimeInSeconds: 170, point: { latitude: at(1200, 0)[0], longitude: at(1200, 0)[1] }, maneuver: 'TURN_LEFT', message: 'Turn left onto Lake View Road', street: 'Lake View Road' },
      { routeOffsetInMeters: 2000, travelTimeInSeconds: 300, point: { latitude: DEST.lat, longitude: DEST.lng }, maneuver: 'ARRIVE_RIGHT', message: 'You have arrived. Your destination is on the right' }
    ] }
  });
  assert.strictEqual(tt.provider, 'tomtom');
  assert.strictEqual(tt.trafficDelayS, 45);
  assert.deepStrictEqual(tt.steps.map((s) => [s.type, s.modifier, Math.round(s.alongM / 10) * 10, s.durationS]), [['depart', 'straight', 0, 170], ['turn', 'left', 1200, 130], ['arrive', 'right', 2000, 0]]);
  assert.strictEqual(tt.steps[1].text, 'Turn left onto Lake View Road');

  // Provider order and fallback; no straight-line fallback exists.
  {
    const calls = [];
    const tomtom = NR.tomtomProvider({ key: () => 'k'.repeat(32), baseUrl: () => 'https://api.tomtom.com', getJSON: async (u) => { calls.push(u); throw Object.assign(new Error('x'), { kind: 'server' }); } });
    const osrm = NR.osrmProvider({ baseUrl: () => 'https://osrm.test', getJSON: async (u) => { calls.push(u); return { code: 'Ok', routes: [OSRM_ROUTE] }; } });
    const svc = NR.createRoutingService([tomtom, osrm]);
    const res = await svc.getRoute({ lat: O[0], lng: O[1] }, DEST, { headingDeg: 92 });
    assert.strictEqual(res.provider, 'osrm', 'falls back to OSRM when TomTom fails');
    assert.ok(/vehicleHeading=92/.test(calls[0]) && /instructionsType=text/.test(calls[0]) && /traffic=true/.test(calls[0]), 'TomTom asked with heading, guidance and traffic');
    assert.ok(/bearings=92,60;/.test(calls[1]) && /steps=true/.test(calls[1]), 'OSRM asked with the travel bearing');
    const noKey = NR.createRoutingService([NR.tomtomProvider({ key: () => null, baseUrl: () => '', getJSON: async () => { throw new Error('must not call'); } }), osrm]);
    assert.strictEqual((await noKey.getRoute({ lat: 1, lng: 2 }, DEST, {})).provider, 'osrm');
    const none = NR.createRoutingService([NR.osrmProvider({ baseUrl: () => '', getJSON: async () => ({ code: 'NoRoute', message: 'Impossible route' }) })]);
    await assert.rejects(none.getRoute({ lat: 1, lng: 2 }, DEST, {}), /Impossible route/);
  }

  // ---------- RouteProgressService ----------
  {
    const pg = P.createProgress(r);
    const a = pg.update(fixAt(300, 4, 0), 0);
    assert.ok(Math.abs(a.alongM - 300) < 3 && a.distFromRouteM < 6);
    assert.strictEqual(a.nextStep.text, 'Turn left onto Lake View Road');
    assert.ok(Math.abs(a.distToNextM - 900) < 3, 'next maneuver in 900 m');
    assert.strictEqual(a.currentRoad, 'Station Road');
    assert.ok(Math.abs(a.remainingM - 1700) < 5);
    assert.ok(Math.abs(a.remainingS - (140 * 0.75 + 100)) < 2, 'time left from step durations: ' + a.remainingS);
    const b = pg.update(fixAt(1200, 300, 1), 1);
    assert.strictEqual(b.currentRoad, 'Lake View Road');
    assert.strictEqual(b.nextStep.type, 'arrive');
    assert.ok(Math.abs(b.remainingM - 500) < 5);
    assert.strictEqual(P.formatDistance(1234), '1.2 km');
    assert.strictEqual(P.formatDistance(347), '350 m');
    assert.strictEqual(P.formatDuration(125 * 60), '2 h 5 min');
  }

  // ---------- off-route detector: tolerant to noise, needs persistence ----------
  {
    const d = P.createOffRouteDetector();
    let t = 0;
    for (let i = 0; i < 20; i++) assert.strictEqual(d.update(25 + (i % 3) * 5, 10, (t += 1000)).offRoute, false, 'GPS wander within threshold');
    assert.strictEqual(d.update(200, 120, (t += 1000)).uncertain, true, 'very inaccurate fix ignored');
    assert.strictEqual(d.update(80, 10, (t += 1000)).offRoute, false);
    assert.strictEqual(d.update(85, 10, (t += 1000)).offRoute, false);
    assert.strictEqual(d.update(90, 10, (t += 1000)).offRoute, false, '3 fixes but only 2 s apart');
    assert.strictEqual(d.update(95, 10, (t += 2500)).offRoute, true, 'persistent deviation -> off route');
    assert.ok(d.threshold(10) === 40 && d.threshold(60) === 80 && d.threshold(500) === 120);
  }

  // ---------- bearing filter ----------
  {
    const bf = P.createBearingFilter();
    bf.update(fixAt(0, 0, 0, { heading: 88, speed: 12 }));
    for (let i = 0; i < 10; i++) bf.update(fixAt(i * 12, 0, i, { heading: 90 + ((i % 2) ? 1.5 : -1.5), speed: 12 }));
    assert.ok(Math.abs(P.angleDiff(bf.value, 90)) < 3 && bf.source === 'gps');
    const bf2 = P.createBearingFilter();
    bf2.update(fixAt(0, 0, 0, { speed: 0, heading: null }), { compass: 10 });
    for (let i = 0; i < 30; i++) bf2.update(fixAt(0, 0, i, { speed: 0, heading: null, noise: 0 }), { compass: 10 + (i % 2 ? 4 : -4) });
    assert.ok(Math.abs(P.angleDiff(bf2.value, 10)) < 2, 'compass noise inside the dead band does not rotate the map');
    const bf3 = P.createBearingFilter();
    bf3.update({ lat: 17.38, lng: 78.48, accuracy: 5, speed: 1, heading: null });
    const v = bf3.update({ lat: 17.38 + 20 / mPerDegLat, lng: 78.48, accuracy: 5, speed: 1, heading: null });
    assert.ok(Math.abs(P.angleDiff(v, 0)) < 1, 'bearing from movement when GPS course is missing');
    assert.ok(Math.abs(P.angleDiff(350, 10)) === 20 && P.angleDiff(10, 350) === -20, 'shortest way round');
  }

  // ---------- voice planner: each stage once ----------
  {
    const vp = P.createVoicePlanner();
    const pg = P.createProgress(r);
    const said = [];
    for (let e = 0; e <= 1200; e += 10) { const s = vp.next(pg.update(fixAt(e, 0, e), e), 12); if (s) said.push(s); }
    for (let k = 0; k < 5; k++) { const s = vp.next(pg.update(fixAt(1195, 0, 2000 + k), 2000 + k), 12); if (s) said.push(s); }
    assert.deepStrictEqual(said, ['In 500 metres, turn left onto Lake View Road', 'In 100 metres, turn left onto Lake View Road', 'Turn left onto Lake View Road'], 'announced: ' + JSON.stringify(said));
    assert.strictEqual(P.spokenDistance(1500), '1.5 kilometres');
    assert.ok(vp.announceArrival() && vp.announceArrival() === null, 'arrival announced once');
  }

  // ---------- fix validation ----------
  {
    const fv = P.createFixValidator();
    assert.ok(fv.check({ lat: 17.38, lng: 78.48, accuracy: 10, timestamp: 1000 }).ok);
    assert.strictEqual(fv.check({ lat: 17.38, lng: 78.48, accuracy: 10, timestamp: 1000 }).reason, 'stale');
    assert.strictEqual(fv.check({ lat: 17.48, lng: 78.48, accuracy: 30, timestamp: 2000 }).reason, 'jump', '11 km in 1 s rejected');
    assert.strictEqual(fv.check({ lat: NaN, lng: 1 }).reason, 'invalid');
    assert.ok(fv.check({ lat: 17.3801, lng: 78.48, accuracy: 120, timestamp: 3000 }).weak);
  }
  {
    // A coarse network fix (±1500 m) must not block the first real GPS fixes that follow.
    const fv = P.createFixValidator();
    assert.ok(fv.check({ lat: 17.38, lng: 78.48, accuracy: 1500, timestamp: 1000 }).ok);
    assert.ok(fv.check({ lat: 17.38 + 1400 / mPerDegLat, lng: 78.48, accuracy: 6, timestamp: 2000 }).ok, 'accurate GPS after a coarse fix accepted');
  }

  // ---------- NavigationController end to end ----------
  function harness(o) {
    let onFix = null, onStatus = null, stopped = 0, t = 0;
    const routeCalls = [], spoken = [], events = [], timers = [];
    const routing = { getRoute: async (from, to, opt) => { routeCalls.push({ from, to, opt }); if (o && o.failRouting) throw Object.assign(new Error('x'), { kind: 'server' }); return { routes: [NR.fromOsrm(o && o.routeFor ? o.routeFor(from) : OSRM_ROUTE)], provider: 'osrm' }; } };
    const ctl = NC.createNavigationController({
      progress: P, routing,
      location: { start(f, s) { onFix = f; onStatus = s; }, stop() { stopped++; } },
      voice: { speak: (s) => spoken.push(s) },
      now: () => t, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
      ui: { onPhase: (p) => events.push('phase:' + p), onRoute: (rt, why) => events.push('route:' + why), onMessage: (m) => events.push('msg:' + m), onArrived: () => events.push('arrived'), onStatus: (s) => events.push('status:' + s.code) }
    });
    const feed = async (f) => { t = f.timestamp; onFix(f); await new Promise((res) => setImmediate(res)); };
    return { ctl, feed, routeCalls, spoken, events, timers, get stopped() { return stopped; }, status: (s) => onStatus(s), setNow: (v) => { t = v; } };
  }

  // 1. Start: routes from the REAL first fix (not a fixed point); preview reused only if on it.
  {
    const h = harness();
    h.ctl.start(DEST);
    assert.strictEqual(h.ctl.phase, 'locating');
    await h.feed(fixAt(20, 3, 1000));
    assert.strictEqual(h.routeCalls.length, 1);
    assert.ok(Math.abs(h.routeCalls[0].from.lat - at(20, 3)[0]) < 1e-9 && Math.abs(h.routeCalls[0].from.lng - at(20, 3)[1]) < 1e-9, 'route origin = the GPS fix');
    assert.deepStrictEqual([h.routeCalls[0].to.lat, h.routeCalls[0].to.lng], [DEST.lat, DEST.lng]);
    assert.strictEqual(h.ctl.phase, 'navigating');

    const h2 = harness();
    h2.ctl.start(DEST, { preview: NR.fromOsrm(OSRM_ROUTE) });
    await h2.feed(fixAt(30, 5, 1000));
    assert.strictEqual(h2.routeCalls.length, 0, 'on the previewed route: preview used, no extra request');
    assert.ok(h2.events.includes('route:preview'));

    const h3 = harness();
    h3.ctl.start(DEST, { preview: NR.fromOsrm(OSRM_ROUTE) });
    await h3.feed(fixAt(400, 600, 1000));
    assert.strictEqual(h3.routeCalls.length, 1, 'GPS far from the preview start: new route from GPS');
  }

  // 2. Weak first fix: waits for a better one (or uses the best after the wait).
  {
    const h = harness();
    h.ctl.start(DEST);
    await h.feed(fixAt(0, 0, 1000, { accuracy: 400 }));
    assert.strictEqual(h.ctl.phase, 'locating');
    assert.ok(h.events.includes('status:weak'));
    await h.feed(fixAt(0, 0, 2000, { accuracy: 15 }));
    assert.strictEqual(h.ctl.phase, 'navigating');
  }

  // 3. Drive with noise: no reroute; then leave the route: exactly one reroute, from the LATEST fix.
  {
    const h = harness({ routeFor: (from) => ({
      distance: 900, duration: 120,
      geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], lnglat(at(1200, 300)), lnglat(at(1200, 800))] },
      legs: [{ steps: [{ name: 'Link Road', distance: 900, duration: 120, maneuver: { type: 'depart', bearing_after: 30, location: [from.lng, from.lat] } }, { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', location: lnglat(at(1200, 800)) } }] }]
    }) });
    h.ctl.start(DEST, { preview: NR.fromOsrm(OSRM_ROUTE) });
    let t = 1000;
    for (let e = 0; e <= 600; e += 12) await h.feed(fixAt(e, 0, (t += 1000), { noise: 12, heading: 90, speed: 12 }));
    assert.strictEqual(h.routeCalls.length, 0, 'GPS noise of ±12 m on the route never reroutes');
    assert.ok(h.ctl.progress.remainingM < 1420 && h.ctl.progress.remainingM > 1380);
    // Turn off the road: head north-east away from the route.
    let last;
    for (let k = 1; k <= 8; k++) { last = fixAt(600 + k * 10, k * 15, (t += 1000), { heading: 30, speed: 12 }); await h.feed(last); }
    assert.strictEqual(h.routeCalls.length, 1, 'one reroute for one deviation');
    const from = h.routeCalls[0].from;
    assert.ok(from.lat > at(600, 50)[0], 'reroute starts from where the user is now, not from the original start');
    assert.ok(h.events.includes('route:reroute') && h.ctl.rerouteCount === 1);
    assert.ok(typeof h.routeCalls[0].opt.headingDeg === 'number', 'reroute passes the current heading');
    assert.ok(h.spoken.includes('Rerouting') && h.spoken.includes('Route updated'));
  }

  // 4. Reroute failure keeps the old route and retries later (no restart needed).
  {
    const h = harness({ failRouting: true });
    h.ctl.start(DEST, { preview: NR.fromOsrm(OSRM_ROUTE) });
    let t = 1000;
    for (let e = 0; e <= 300; e += 12) await h.feed(fixAt(e, 0, (t += 1000)));
    for (let k = 1; k <= 8; k++) await h.feed(fixAt(300, k * 15, (t += 1500)));
    assert.strictEqual(h.ctl.phase, 'navigating', 'still navigating on the old route');
    assert.ok(h.events.some((e) => /Keeping the previous route/.test(e)), JSON.stringify(h.events) + ' calls=' + h.routeCalls.length);
    const n = h.routeCalls.length;
    for (let k = 0; k < 4; k++) await h.feed(fixAt(300, 130 + k * 5, (t += 1000)));
    assert.strictEqual(h.routeCalls.length, n, 'no reroute storm');
    for (let k = 0; k < 6; k++) await h.feed(fixAt(300, 150 + k * 5, (t += 4000)));
    assert.ok(h.routeCalls.length > n, 'retried after the back-off');
  }

  // 5. Arrival within an accuracy-based radius; location updates stop.
  {
    const h = harness();
    h.ctl.start(DEST, { preview: NR.fromOsrm(OSRM_ROUTE) });
    let t = 0;
    for (let n = 0; n <= 800; n += 25) await h.feed(fixAt(1200, n, (t += 1000)));
    assert.strictEqual(h.ctl.phase, 'arrived');
    assert.strictEqual(h.stopped, 1, 'GPS updates stopped on arrival');
    assert.ok(h.spoken.includes('You have arrived at your destination'));
    assert.ok(P.hasArrived({ lat: DEST.lat + 35 / mPerDegLat, lng: DEST.lng, accuracy: 40 }, DEST, null), '35 m away with ±40 m accuracy counts');
    assert.ok(!P.hasArrived({ lat: DEST.lat + 35 / mPerDegLat, lng: DEST.lng, accuracy: 5 }, DEST, null), 'but not with ±5 m accuracy');
  }

  // 5b. Starting again on the same controller stops the previous GPS watch first.
  {
    const h = harness();
    h.ctl.start(DEST);
    await h.feed(fixAt(20, 3, 1000));
    h.ctl.start(DEST);
    assert.strictEqual(h.stopped, 1, 'previous watch stopped on restart');
    assert.strictEqual(h.ctl.phase, 'locating');
  }

  // 6. Permission denied before any fix -> error phase with the message.
  {
    const h = harness();
    h.ctl.start(DEST);
    h.status({ code: 'denied-permanent', message: 'Location is blocked' });
    assert.strictEqual(h.ctl.phase, 'error');
    h.ctl.stop();
    assert.strictEqual(h.ctl.phase, 'stopped');
  }

  console.log('✓ routes normalised from OSRM and TomTom (steps, maneuvers, road names); provider fallback; progress, ETA and next maneuver from the GPS position; noise-tolerant off-route detection; reroute from the latest fix; arrival radius; voice once per stage; bearing smoothing; fix validation.');
})().catch((e) => { console.error(e); process.exit(1); });
