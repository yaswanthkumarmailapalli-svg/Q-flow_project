/* =========================================================
   Q-FLOW — NAVIGATION: LocationService (the device's real GPS)
   UMD: browser global QFlowNavLocation, or require() in Node tests (with a fake geolocation).

   start(onFix, onStatus) watches the device position (navigator.geolocation.watchPosition with
   high accuracy; in the Android app Capacitor's WebView maps this to Android's location
   provider and runtime permission). Every reading becomes
     { lat, lng, accuracy, heading, speed, altitude, timestamp }
   onStatus({ code, message }) reports: searching | ok | weak | lost | denied |
   denied-permanent | off | unsupported | insecure | paused.
   Lifecycle: a watchdog reports "lost" when no reading arrives for 15 s and restarts the
   watch; when the page/app goes to the background the watch is stopped (Android pauses the
   WebView anyway) and restarted on return. Also provides an optional compass heading.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNavLocation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MSG = {
    searching: 'Getting your location from GPS…',
    weak: (acc) => 'Weak GPS signal (±' + Math.round(acc) + ' m). Move to an open area for a better fix.',
    lost: 'GPS signal lost. Waiting for your location… (check that Location is on)',
    denied: 'Location permission was denied. Navigation needs your location: allow it when asked, or in your phone settings.',
    deniedPermanent: 'Location is blocked for Q-FLOW. Open Settings > Apps > Q-FLOW > Permissions > Location, choose "Allow" and "Use precise location", then try again.',
    off: 'Location is turned off or unavailable. Turn on Location (GPS) in your phone\'s quick settings, then try again.',
    unsupported: 'This device or browser does not provide location.',
    insecure: 'Location only works on https:// pages or http://localhost. Open the app from a secure address.',
    coarse: 'Only approximate location is allowed. For navigation, allow "Precise location" for Q-FLOW in your phone settings.',
    paused: 'Navigation paused while the app is in the background.'
  };

  function createLocationService(env) {
    const e = env || {};
    const geo = e.geolocation;
    const doc = e.document;
    const now = e.now || (() => Date.now());
    const setT = e.setTimeout || setTimeout, clearT = e.clearTimeout || clearTimeout;
    const cfg = Object.assign({ lostAfterMs: 15000, weakAccuracyM: 50, coarseAccuracyM: 500 }, e.config || {});
    let watchId = null, onFix = null, onStatus = null, lastFixAt = 0, hadFix = false, startAt = 0, dog = null, running = false, status = null, hidden = false;
    let compass = null, compassAt = 0, orientHandler = null;

    const report = (code, message) => {
      if (status === code) return;
      status = code;
      if (onStatus) onStatus({ code, message });
    };

    function toFix(pos) {
      const c = pos.coords || {};
      const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return { lat: c.latitude, lng: c.longitude, accuracy: n(c.accuracy), heading: n(c.speed) !== null && c.speed > 0 ? n(c.heading) : null,
        speed: n(c.speed), altitude: n(c.altitude), timestamp: n(pos.timestamp) || now() };
    }

    function watch() {
      if (watchId !== null || !geo) return;
      startAt = now();
      watchId = geo.watchPosition(
        (pos) => {
          const f = toFix(pos);
          lastFixAt = now(); hadFix = true;
          if (f.accuracy !== null && f.accuracy > cfg.coarseAccuracyM) report('weak', MSG.coarse);
          else if (f.accuracy !== null && f.accuracy > cfg.weakAccuracyM) report('weak', MSG.weak(f.accuracy));
          else report('ok', '');
          if (onFix) onFix(f);
        },
        (err) => {
          const code = err && err.code;
          if (code === 1) {
            // Android answers instantly (no dialog) when the permission was denied permanently.
            const instant = now() - startAt < 400;
            unwatch();
            running = false;
            report(instant ? 'denied-permanent' : 'denied', instant ? MSG.deniedPermanent : MSG.denied);
          } else if (code === 2) report('off', MSG.off);
          else report(hadFix ? 'lost' : 'searching', hadFix ? MSG.lost : MSG.searching); // 3 = timeout: keep watching
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
      );
      armDog();
    }
    function unwatch() {
      if (watchId !== null && geo) geo.clearWatch(watchId);
      watchId = null;
      clearT(dog);
    }
    // Watchdog: no reading for lostAfterMs -> "lost", and restart the watch (some devices
    // silently stop delivering updates after the GPS drops).
    function armDog() {
      clearT(dog);
      dog = setT(() => {
        if (!running || hidden) return;
        // Measured from the later of the last fix and the last (re)start, so a lost signal
        // restarts the watch once per lostAfterMs, not every 5 s.
        if (now() - Math.max(hadFix ? lastFixAt : 0, startAt) >= cfg.lostAfterMs) {
          report(hadFix ? 'lost' : 'searching', hadFix ? MSG.lost : MSG.searching);
          unwatch();
          watch();
        } else armDog();
      }, 5000);
    }

    function onVisibility() {
      if (!running) return;
      if (doc.visibilityState === 'hidden') { hidden = true; unwatch(); report('paused', MSG.paused); }
      else if (hidden) { hidden = false; report('searching', MSG.searching); watch(); }
    }

    // Compass (device orientation), used only as a fallback when standing still.
    function startCompass() {
      const w = e.window;
      if (!w || orientHandler) return;
      orientHandler = (ev) => {
        let h = null;
        if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading;
        else if (ev.absolute && typeof ev.alpha === 'number') h = 360 - ev.alpha;
        if (h === null) return;
        const so = w.screen && w.screen.orientation && typeof w.screen.orientation.angle === 'number' ? w.screen.orientation.angle : 0;
        compass = (((h + so) % 360) + 360) % 360;
        compassAt = now();
      };
      const evName = 'ondeviceorientationabsolute' in w ? 'deviceorientationabsolute' : 'deviceorientation';
      w.addEventListener(evName, orientHandler);
      orientHandler._ev = evName;
    }
    function stopCompass() {
      if (orientHandler && e.window) e.window.removeEventListener(orientHandler._ev, orientHandler);
      orientHandler = null; compass = null;
    }

    return {
      MSG,
      start(fixCb, statusCb) {
        onFix = fixCb; onStatus = statusCb; status = null; lastFixAt = 0; hadFix = false;
        if (!geo) { report('unsupported', MSG.unsupported); return; }
        if (e.window && e.window.isSecureContext === false) { report('insecure', MSG.insecure); return; }
        running = true; hidden = false;
        report('searching', MSG.searching);
        if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);
        startCompass();
        watch();
      },
      stop() {
        running = false;
        unwatch();
        stopCompass();
        if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
      },
      // Compass heading in degrees if a reading is less than 2 s old, else null.
      compass() { return compass !== null && now() - compassAt < 2000 ? compass : null; },
      get running() { return running; }
    };
  }

  return { createLocationService };
});
