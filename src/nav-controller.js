/* =========================================================
   Q-FLOW — NAVIGATION: NavigationController
   UMD: browser global QFlowNavController, or require() in Node tests.

   Pipeline for every real GPS fix (from LocationService):
     fix -> validation -> bearing filter -> route progress -> camera/marker (ui)
         -> ETA / distance (ui) -> voice -> off-route check -> arrival check
   Phases: idle -> locating -> routing -> navigating <-> rerouting -> arrived | stopped | error

   All dependencies are injected:
     location: { start(onFix, onStatus), stop() }        (nav-location.js in the app)
     routing:  { getRoute(origin, destination, options) } (nav-routing.js)
     progress: QFlowNavProgress                            (nav-progress.js)
     ui:       callbacks (all optional): onPhase, onFix, onRoute, onProgress, onStatus, onMessage, onArrived
     voice:    { speak(text) } (optional)
     compass:  () => degrees | null (optional)
     now:      () => ms, setTimeout
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNavController = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function createNavigationController(deps) {
    const P = deps.progress;
    const ui = deps.ui || {};
    const now = deps.now || (() => Date.now());
    const later = deps.setTimeout || setTimeout;
    const cfg = Object.assign({
      firstFixAccuracyM: 100,  // first fix used for routing if at least this good...
      firstFixWaitMs: 8000,    // ...or after waiting this long for a better one
      rerouteMinIntervalMs: 10000,
      rerouteRetryMs: 15000,
      previewMaxOffsetM: 60    // a previewed route is reused only if the user is on it
    }, deps.config || {});

    let phase = 'idle', destination = null, route = null, tracker = null, preview = null, opts = {};
    let fix = null, lastProgress = null, startedAt = 0, lastRerouteAt = -Infinity, rerouteCount = 0, waitTimer = null, retryTimer = null;
    let via = []; // intermediate stops [{ lat, lng, label, reached }]
    const validator = P.createFixValidator();
    const bearing = P.createBearingFilter();
    let offRoute = P.createOffRouteDetector(cfg.offRoute);
    let voicePlan = P.createVoicePlanner();

    const emit = (name, ...a) => { try { if (ui[name]) ui[name](...a); } catch (e) { /* UI errors must not stop navigation */ } };
    const setPhase = (p, info) => { phase = p; emit('onPhase', p, info || {}); };
    const say = (t) => { if (t && deps.voice && deps.voice.speak) { try { deps.voice.speak(t); } catch (e) { /* optional */ } } };

    function useRoute(r, why) {
      route = r;
      tracker = P.createProgress(r);
      offRoute.reset();
      voicePlan.reset();
      emit('onRoute', r, why || 'initial');
      setPhase('navigating', { reason: why || 'initial' });
      if (fix) handleNavFix(fix);
    }

    // Always routes from the given (latest real) location to the kept destination.
    async function recalculateRoute(currentLocation, dest) {
      const headingDeg = bearing.source === 'gps' || bearing.source === 'movement' ? bearing.value : null;
      const res = await deps.routing.getRoute(
        { lat: currentLocation.lat, lng: currentLocation.lng },
        { lat: dest.lat, lng: dest.lng },
        Object.assign({ alternatives: false, headingDeg, via: via.filter((v) => !v.reached).map((v) => ({ lat: v.lat, lng: v.lng })) }, opts.routeOptions || {})
      );
      return res.routes[0];
    }

    async function routeFromFix(why) {
      const from = fix;
      try {
        const r = await recalculateRoute(from, destination);
        if (phase === 'stopped' || phase === 'arrived') return;
        if (why === 'reroute') { rerouteCount++; say('Route updated'); }
        useRoute(r, why);
      } catch (e) {
        if (phase === 'stopped' || phase === 'arrived') return;
        const msg = e && e.kind === 'offline' ? 'No internet connection: cannot calculate a route.' :
          e && e.kind === 'no-route' ? 'No drivable route was found to the destination from here.' :
          'Could not calculate a route right now.';
        if (route) {
          emit('onMessage', msg + ' Keeping the previous route; trying again shortly.', 'warn');
          setPhase('navigating', { reason: 'reroute-failed' });
          offRoute.reset();
          lastRerouteAt = now() - cfg.rerouteMinIntervalMs + cfg.rerouteRetryMs;
        } else {
          setPhase('error', { message: msg });
          emit('onMessage', msg, 'error');
          clearTimeout(retryTimer);
          retryTimer = later(() => { retryTimer = null; if (phase === 'error' && fix) { setPhase('routing'); routeFromFix(why); } }, cfg.rerouteRetryMs);
        }
      }
    }

    function beginRouting() {
      if (phase !== 'locating') return;
      clearTimeout(waitTimer);
      setPhase('routing');
      // The previewed route (from the route-choice screen) is used as-is only when the real
      // GPS position is on it; otherwise a new route is calculated from the GPS position.
      if (preview) {
        const pr = P.project(preview, [fix.lat, fix.lng]);
        if (pr.distM <= cfg.previewMaxOffsetM && pr.alongM < preview.lengthM * 0.9) return useRoute(preview, 'preview');
      }
      routeFromFix('initial');
    }

    function handleNavFix(f) {
      // Stops passed within an accuracy-based radius are not routed through again.
      via.forEach((v) => { if (!v.reached && P.haversineM([f.lat, f.lng], [v.lat, v.lng]) <= Math.max(40, f.accuracy || 0)) v.reached = true; });
      const pr = tracker.update(f, now());
      lastProgress = pr;
      const thr = offRoute.threshold(f.accuracy);
      const b = bearing.update(f, { routeBearing: pr.routeBearing, onRoute: pr.distFromRouteM <= thr, compass: deps.compass ? deps.compass() : null });
      emit('onProgress', pr, f, { bearing: b, source: bearing.source });

      if (P.hasArrived(f, destination, pr)) return arrive();

      const off = offRoute.update(pr.distFromRouteM, f.accuracy, isNum(f.timestamp) ? f.timestamp : now());
      if (off.offRoute && phase === 'navigating' && now() - lastRerouteAt >= cfg.rerouteMinIntervalMs) {
        lastRerouteAt = now();
        setPhase('rerouting');
        emit('onMessage', 'You left the route. Finding a new route from your current position…', 'info');
        say('Rerouting');
        routeFromFix('reroute');
        return;
      }
      if (phase === 'navigating' && !off.away) say(voicePlan.next(pr, f.speed));
    }

    function onFix(f) {
      if (phase === 'idle' || phase === 'stopped' || phase === 'arrived') return;
      const v = validator.check(f);
      if (!v.ok) return;
      fix = f;
      emit('onFix', f, { weak: v.weak });
      if (phase === 'locating') {
        if (!isNum(f.accuracy) || f.accuracy <= cfg.firstFixAccuracyM || now() - startedAt >= cfg.firstFixWaitMs) beginRouting();
        else emit('onStatus', { code: 'weak', message: 'Weak GPS signal (±' + Math.round(f.accuracy) + ' m). Waiting for a better fix…' });
        return;
      }
      if (phase === 'error' || phase === 'routing') { bearing.update(f, {}); return; }
      if (tracker) handleNavFix(f);
    }

    function arrive() {
      setPhase('arrived');
      deps.location.stop();
      say(voicePlan.announceArrival());
      emit('onArrived', { destination, rerouteCount });
    }

    return {
      get phase() { return phase; },
      get route() { return route; },
      get fix() { return fix; },
      get progress() { return lastProgress; },
      get bearing() { return { value: bearing.value, source: bearing.source }; },
      get rerouteCount() { return rerouteCount; },

      // destination: { lat, lng, label }; o.preview: NavRoute shown before Start (optional)
      start(dest, o) {
        if (!dest || !isNum(+dest.lat) || !isNum(+dest.lng)) throw new Error('A destination with coordinates is required.');
        if (phase !== 'idle' && phase !== 'stopped' && phase !== 'arrived') { clearTimeout(waitTimer); clearTimeout(retryTimer); deps.location.stop(); }
        destination = { lat: +dest.lat, lng: +dest.lng, label: dest.label || 'Destination' };
        opts = o || {};
        preview = opts.preview || null;
        via = (opts.via || []).filter((v) => v && isNum(+v.lat) && isNum(+v.lng)).map((v) => ({ lat: +v.lat, lng: +v.lng, label: v.label || 'Stop', reached: false }));
        route = null; tracker = null; fix = null; lastProgress = null; rerouteCount = 0; lastRerouteAt = -Infinity;
        validator.reset(); bearing.reset(); offRoute = P.createOffRouteDetector(cfg.offRoute); voicePlan = P.createVoicePlanner();
        startedAt = now();
        setPhase('locating');
        deps.location.start(onFix, (st) => {
          emit('onStatus', st);
          if (st && (st.code === 'denied' || st.code === 'denied-permanent' || st.code === 'unsupported' || st.code === 'insecure') && !fix) setPhase('error', { message: st.message });
        });
        // If only inaccurate fixes arrive, start with the best available after firstFixWaitMs.
        waitTimer = later(() => { if (phase === 'locating' && fix) beginRouting(); }, cfg.firstFixWaitMs);
      },
      stop() {
        clearTimeout(waitTimer); clearTimeout(retryTimer);
        if (phase !== 'arrived') setPhase('stopped');
        deps.location.stop();
      },
      recalculateRoute,
      // Manual re-route from the latest fix (e.g. a "Re-route" button).
      reroute() { if (fix && destination && (phase === 'navigating' || phase === 'error')) { clearTimeout(retryTimer); lastRerouteAt = now(); setPhase('rerouting'); routeFromFix('reroute'); } },
      // Exposed for tests and the UI.
      _onFix: onFix
    };
  }

  return { createNavigationController };
});
