/* =========================================================
   Q-FLOW — LOCATION: browser geolocation with IP fallback
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: config.js (qflowNet, QFLOW_CONFIG), geocode.js at call time.
   ========================================================= */

/* ---------- GEOLOCATION WITH REVERSE GEOCODING ----------
   Permission flow (browser and the Android app, where Capacitor's WebView turns
   navigator.geolocation into the Android runtime permission prompt):
   1. If permission is already granted, locate straight away.
   2. If it was denied, don't ask again and don't fall back to an IP lookup:
      the user said no, so they type their starting point instead.
   3. Otherwise, before the system prompt, show a short rationale screen once.
      "Not now" also means manual search; it is remembered so the app doesn't nag,
      but the user can still tap the locate button (userInitiated) to be asked again.
   Non-permission failures (no GPS fix, timeout, no geolocation API) try a quick
   network fix and then the IP-lookup fallback (labelled approximate).
   cb(location) on success; cb(null, { reason }) otherwise, where reason is
   'denied' | 'declined' | 'unavailable'. */
const QFLOW_LOC_RATIONALE_KEY = 'qflowLocRationale'; // 'accepted' | 'declined'

// Pure decision step (tested in test/test_location.js).
// state: 'granted' | 'denied' | 'prompt' | 'unknown'; stored: rationale answer or null.
function qflowLocationDecision(state, stored, userInitiated) {
  if (state === 'granted') return 'locate';
  if (state === 'denied') return 'manual-denied';
  if (stored === 'accepted') return 'locate';
  if (stored === 'declined' && !userInitiated) return 'manual-declined';
  return 'ask';
}

// True inside the Capacitor Android app. There the WebView's Permissions API does not
// reflect Android's runtime permission, so we let Android decide (it shows its own prompt,
// or answers "denied" straight away if the user blocked it).
function qflowIsNativeApp() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; }
}

function qflowLocationPermissionState() {
  if (qflowIsNativeApp()) return Promise.resolve('unknown');
  try {
    if (navigator.permissions && navigator.permissions.query) {
      return navigator.permissions
        .query({ name: 'geolocation' })
        .then((p) => (p && ['granted', 'denied', 'prompt'].includes(p.state) ? p.state : 'unknown'))
        .catch(() => 'unknown');
    }
  } catch (e) { /* Permissions API not available (e.g. some WebViews) */ }
  return Promise.resolve('unknown');
}

// Rationale screen shown before the system permission prompt. Resolves true for "Continue".
function qflowLocationRationale() {
  return new Promise((resolve) => {
    const show = () => {
      // Wait for the first-run tips overlay (mode.js) to close so they don't stack.
      if (document.querySelector('.tips:not(.loc-rationale)')) return setTimeout(show, 400);
      const o = document.createElement('div');
      o.className = 'tips loc-rationale';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.setAttribute('aria-labelledby', 'locRationaleTitle');
      const card = document.createElement('div');
      card.className = 'tip-card';
      const ico = document.createElement('div');
      ico.className = 'tip-ico';
      ico.textContent = '📍';
      const h = document.createElement('h2');
      h.id = 'locRationaleTitle';
      h.textContent = 'Use your location?';
      const p = document.createElement('p');
      p.textContent =
        'Q-FLOW uses it only to set your starting point. Your position is sent to the map services that find the street name and the route, and kept on this phone. You can say no and type your starting point instead.';
      const yes = document.createElement('button');
      yes.className = 'primary wide';
      yes.type = 'button';
      yes.textContent = 'Continue';
      const no = document.createElement('button');
      no.className = 'tip-skip';
      no.type = 'button';
      no.textContent = "Not now, I'll type it";
      card.append(ico, h, p, yes, no);
      o.append(card);
      const finish = (ok) => {
        document.removeEventListener('keydown', onKey);
        o.remove();
        resolve(ok);
      };
      const onKey = (e) => { if (e.key === 'Escape') finish(false); };
      yes.onclick = () => finish(true);
      no.onclick = () => finish(false);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(o);
      yes.focus();
    };
    show();
  });
}

// opts.userInitiated: true when the user tapped a "locate me" button.
function qflowGetLocation(cb, opts = {}) {
  if (!navigator.geolocation) {
    fallbackIP(cb, 'unsupported');
    return;
  }
  qflowLocationPermissionState().then((state) => {
    const decision = qflowLocationDecision(state, localStorage.getItem(QFLOW_LOC_RATIONALE_KEY), !!opts.userInitiated);
    if (decision === 'manual-denied') return cb(null, { reason: 'denied' });
    if (decision === 'manual-declined') return cb(null, { reason: 'declined' });
    if (decision === 'ask') {
      return qflowLocationRationale().then((ok) => {
        localStorage.setItem(QFLOW_LOC_RATIONALE_KEY, ok ? 'accepted' : 'declined');
        if (ok) _qflowLocate(cb);
        else cb(null, { reason: 'declined' });
      });
    }
    _qflowLocate(cb);
  });
}

// How long to keep refining a fix, and when it is good enough to stop early.
const QFLOW_LOC_GOOD_M = 50;        // stop as soon as a fix is this accurate
const QFLOW_LOC_SETTLE_MS = 6000;   // after the first fix, wait at most this long for a better one
const QFLOW_LOC_MAX_MS = 20000;     // overall limit for the precise (GPS) attempt

// Precise first: watch with GPS (enableHighAccuracy) and keep the most accurate fix,
// stopping at <= 50 m, 6 s after the first fix, or after 20 s. A cold GPS start
// often needs 10-20 s, which the old single 8 s low-accuracy request did not allow.
// If GPS gives nothing, try a quick network/Wi-Fi fix (a recent cached one is fine),
// and only then the city-level IP lookup. PERMISSION_DENIED never falls back to IP.
function _qflowLocate(cb) {
  const geo = navigator.geolocation;
  let best = null, done = false, watchId = null, settleTimer = null, maxTimer = null;
  const stop = () => {
    done = true;
    if (watchId !== null && geo.clearWatch) geo.clearWatch(watchId);
    clearTimeout(settleTimer); clearTimeout(maxTimer);
  };
  const deliver = (pos) => {
    const acc = pos.coords.accuracy;
    // accuracyM: the device's own estimate (68% radius, metres); source tells the UI how it was found.
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device', accuracyM: Number.isFinite(acc) ? Math.round(acc) : null };
    qflowReverseGeocode(loc, (label) => {
      const full = { ...loc, label };
      saveLoc(full);
      cb(full);
    });
  };
  const accOf = (pos) => (Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : Infinity);
  const finishWithBest = () => { if (done) return; stop(); if (best) deliver(best); else coarse(); };
  const onPos = (pos) => {
    if (done) return;
    if (!best || accOf(pos) < accOf(best)) best = pos;
    if (accOf(best) <= QFLOW_LOC_GOOD_M) return finishWithBest();
    if (!settleTimer) settleTimer = setTimeout(finishWithBest, QFLOW_LOC_SETTLE_MS);
  };
  const onErr = (err) => {
    if (done) return;
    if (err && err.code === 1) { // PERMISSION_DENIED: no IP lookup
      stop();
      // In the app, remember it so automatic starts don't re-prompt; the locate button still asks.
      if (qflowIsNativeApp()) localStorage.setItem(QFLOW_LOC_RATIONALE_KEY, 'declined');
      return cb(null, { reason: 'denied' });
    }
    if (best) return finishWithBest();
    if (watchId === null) { stop(); coarse(err); } // one-shot request failed
    // watchPosition errors (e.g. one timeout) are not final: keep waiting until maxTimer.
  };
  // Quick fallback: network / Wi-Fi location, accepting a fix up to 10 minutes old.
  const coarse = (firstErr) => {
    geo.getCurrentPosition(
      (pos) => deliver(pos),
      (err) => {
        if (err && err.code === 1) return cb(null, { reason: 'denied' });
        const code = (err && err.code) || (firstErr && firstErr.code);
        fallbackIP(cb, code === 2 ? 'off' : 'timeout');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  };
  const precise = { enableHighAccuracy: true, timeout: QFLOW_LOC_MAX_MS, maximumAge: 0 };
  maxTimer = setTimeout(finishWithBest, QFLOW_LOC_MAX_MS);
  if (geo.watchPosition) watchId = geo.watchPosition(onPos, onErr, precise);
  else geo.getCurrentPosition((pos) => { onPos(pos); finishWithBest(); }, onErr, precise);
}

// Callers show their own "location failed" message, so this lookup is silent.
// why: 'off' (device location services off / no provider) or 'timeout' (no fix in time).
function fallbackIP(cb, why) {
  qflowNet
    .getJSON(QFLOW_CONFIG.ipLookupUrl, {
      service: 'ipapi',
      label: 'The IP location lookup (ipapi.co)',
      ttlMs: QFLOW_CONFIG.cacheTtlMs.ipLookup,
      cacheIf: (d) => !!(d && d.latitude && d.longitude),
      silent: true
    })
    .then((d) => {
      if (d.latitude && d.longitude) {
        const full = {
          lat: d.latitude,
          lng: d.longitude,
          label: d.city ? d.city + ', ' + d.region : 'Your Location',
          source: 'ip', // approximate: from the internet connection, roughly city-level
          accuracyM: null
        };
        saveLoc(full);
        cb(full);
      } else {
        cb(null, { reason: 'unavailable', why });
      }
    })
    .catch(() => cb(null, { reason: 'unavailable', why }));
}

// Short human description of how precise a location is (for the UI).
function qflowLocationAccuracyText(loc) {
  if (!loc) return '';
  if (loc.source === 'ip') return 'approximate, from your internet connection (city level)';
  if (Number.isFinite(loc.accuracyM)) return '±' + (loc.accuracyM >= 1000 ? (loc.accuracyM / 1000).toFixed(1) + ' km' : loc.accuracyM + ' m') + ', from this device';
  return 'from this device';
}

// Plain-language advice when no device location could be found (info from the callback).
function qflowLocationHelpText(info) {
  if (info && info.why === 'off') return 'Turn on Location (GPS) on your phone, then tap 📍 again, or type your starting point.';
  if (typeof location !== 'undefined' && location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return 'This browser only allows location on https:// or localhost pages. Type your starting point.';
  return 'No GPS fix yet. Go near a window or outdoors and tap 📍 again, or type your starting point.';
}

// Extra advice when the device fix is coarse (e.g. Android "Approximate" location chosen).
function qflowLocationAccuracyHint(loc) {
  if (!loc || loc.source !== 'device' || !Number.isFinite(loc.accuracyM) || loc.accuracyM <= 500) return '';
  return loc.accuracyM >= 1000
    ? 'If you chose "Approximate" location, allow "Precise" for Q-FLOW in your phone\'s settings.'
    : 'Turn on GPS / high-accuracy location for a better fix.';
}

function saveLoc(full) {
  localStorage.setItem('qflowLocLabel', full.label);
  localStorage.setItem('qflowLocLat', full.lat);
  localStorage.setItem('qflowLocLng', full.lng);
}

