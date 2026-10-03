/* =========================================================
   Q-FLOW — CONFIG, STATUS BAR & NETWORK CLIENT
   Formerly the top of app.js. SIH26137 quantum-inspired & metaheuristic
   routing (classical code; runs on ordinary CPUs, no quantum hardware).
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: net.js (QFlowNet).
   ========================================================= */

/* ---------- EXTERNAL SERVICE CONFIG ----------
   Every external endpoint lives here so it can be swapped for a self-hosted
   server. To override without editing this file, define window.QFLOW_CONFIG
   before config.js loads, e.g.
     <script>window.QFLOW_CONFIG = { osrmBaseUrl: 'https://osrm.example.org' };</script>
   (shallow merge: to change one tile URL, pass the whole `tiles` object).
   See README "External services" for usage policies. */
const QFLOW_CONFIG = Object.assign(
  {
    osrmBaseUrl: 'https://router.project-osrm.org', // public demo server: no SLA
    osrmProfile: 'driving',
    nominatimBaseUrl: 'https://nominatim.openstreetmap.org', // max 1 request/second
    photonBaseUrl: 'https://photon.komoot.io',
    ipLookupUrl: 'https://ipapi.co/json/',
    overpassUrl: 'https://overpass-api.de/api/interpreter',
    // Live traffic (optional): TomTom. No key here: set it in Appearance > Live traffic,
    // or build with the QFLOW_TOMTOM_KEY environment variable (README "Live traffic").
    tomtomBaseUrl: 'https://api.tomtom.com',
    tomtomKey: '',
    tiles: {
      streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
    },
    requestTimeoutMs: 8000, // per attempt
    retries: 1, // one retry with backoff on timeout / network / 429 / 5xx
    retryBackoffMs: 600,
    nominatimMinIntervalMs: 1000,
    autocompleteDebounceMs: 300,
    cacheTtlMs: {
      reverseGeocode: 7 * 24 * 3600e3,
      autocomplete: 24 * 3600e3,
      route: 3600e3,
      ipLookup: 24 * 3600e3,
      places: 24 * 3600e3,
      live: { incidents: 120e3, route: 120e3, matrix: 300e3 } // live data goes stale fast
    }
  },
  (typeof window !== 'undefined' && window.QFLOW_CONFIG) || {}
);

/* ---------- STATUS BAR (offline + service errors) ----------
   Reuses the .offline-bar element: a persistent message while offline, and a
   temporary message when an external service fails after its retry. */
const qflowStatus = (() => {
  const OFFLINE_MSG = 'No internet. Showing the last known area. Routes may not update.';
  let bar = null, timer = null, serviceMsg = null;
  function el() {
    if (!bar) bar = document.querySelector('.offline-bar');
    if (!bar && document.body) {
      bar = document.createElement('div');
      bar.className = 'offline-bar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    return bar;
  }
  function paint() {
    const b = el();
    if (!b) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    b.textContent = offline ? OFFLINE_MSG : serviceMsg || '';
    b.classList.toggle('show', offline || !!serviceMsg);
    b.classList.toggle('service', !offline && !!serviceMsg);
  }
  return {
    refresh: paint,
    service(msg, ms = 8000) {
      serviceMsg = msg;
      paint();
      clearTimeout(timer);
      timer = setTimeout(() => { serviceMsg = null; paint(); }, ms);
    }
  };
})();
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => qflowStatus.refresh());
  window.addEventListener('offline', () => qflowStatus.refresh());
}

const qflowNet = QFlowNet.create({
  timeoutMs: QFLOW_CONFIG.requestTimeoutMs,
  retries: QFLOW_CONFIG.retries,
  backoffMs: QFLOW_CONFIG.retryBackoffMs,
  onError: (err) => qflowStatus.service(err.userMessage)
});

