/* Q-FLOW network helper for external services (OSRM, Nominatim, Photon, ipapi.co, Overpass).
   - Per-attempt timeout via AbortController (default 8 s)
   - One retry with backoff on timeouts, network errors, HTTP 429 and 5xx
   - Optional per-service minimum interval (e.g. Nominatim: max 1 request/second)
   - In-memory + localStorage cache with TTL, keyed by request URL; an expired
     entry is still served if the network request fails ("stale-if-error")
   - Errors carry a plain-language `userMessage` for the UI
   Loaded before config.js in the browser (window.QFlowNet); require()-able in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function abortError() {
    const e = new Error('Request cancelled');
    e.name = 'AbortError';
    return e;
  }

  // kind: offline | timeout | rate-limit | server | http | network | bad-response
  class ServiceError extends Error {
    constructor(kind, service, userMessage, extra) {
      super(userMessage);
      this.name = 'ServiceError';
      this.kind = kind;
      this.service = service;
      this.userMessage = userMessage;
      Object.assign(this, extra || {});
    }
  }

  const RETRYABLE = new Set(['timeout', 'network', 'rate-limit', 'server']);

  function describe(kind, label, extra) {
    const again = ' Please try again in a moment.';
    switch (kind) {
      case 'offline': return 'No internet connection. ' + label + ' needs a connection.';
      case 'timeout': return label + ' did not respond within ' + Math.round(extra.timeoutMs / 1000) + ' s.' + again;
      case 'rate-limit': return label + ' is limiting requests right now (too many requests).' + again;
      case 'server': return label + ' is having problems (HTTP ' + extra.status + ').' + again;
      case 'http': return label + ' rejected the request (HTTP ' + extra.status + ').';
      case 'bad-response': return label + ' sent a response Q-FLOW could not read.';
      default: return 'Could not reach ' + label + '. Check your connection.' + again;
    }
  }

  function create(opts) {
    opts = opts || {};
    const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;
    const now = opts.now || (() => Date.now());
    const timeoutMs = opts.timeoutMs || 8000;
    const retries = opts.retries === undefined ? 1 : opts.retries;
    const backoffMs = opts.backoffMs === undefined ? 600 : opts.backoffMs;
    const isOnline = opts.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    const onError = opts.onError || null;
    const prefix = opts.storagePrefix || 'qflowCache:';
    const maxEntryBytes = opts.maxEntryBytes || 300000;
    const maxEntries = opts.maxEntries || 80;
    const memory = new Map();
    const nextSlot = {};

    function sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(abortError());
        const t = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
      });
    }

    // ---------- cache ----------
    function storageKeys() {
      const keys = [];
      if (!storage) return keys;
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.indexOf(prefix) === 0) keys.push(k);
        }
      } catch (e) { /* storage unavailable */ }
      return keys;
    }
    function evictOldest(count) {
      const entries = storageKeys().map((k) => {
        let t = 0;
        try { t = JSON.parse(storage.getItem(k)).t || 0; } catch (e) { /* corrupt entry: evict first */ }
        return { k, t };
      }).sort((a, b) => a.t - b.t);
      entries.slice(0, count).forEach((e) => { try { storage.removeItem(e.k); } catch (err) { /* ignore */ } });
    }
    // Returns { value, fresh } or null.
    function cacheGet(url) {
      let entry = memory.get(url);
      if (!entry && storage) {
        try {
          const raw = storage.getItem(prefix + url);
          if (raw) { entry = JSON.parse(raw); memory.set(url, entry); }
        } catch (e) { entry = null; }
      }
      if (!entry) return null;
      return { value: entry.v, fresh: now() < entry.exp };
    }
    function cacheSet(url, value, ttlMs) {
      const entry = { t: now(), exp: now() + ttlMs, v: value };
      memory.set(url, entry);
      if (!storage) return;
      let raw;
      try { raw = JSON.stringify(entry); } catch (e) { return; }
      if (raw.length > maxEntryBytes) return; // keep very large responses in memory only
      const write = () => storage.setItem(prefix + url, raw);
      try {
        const keys = storageKeys();
        if (keys.length >= maxEntries && keys.indexOf(prefix + url) < 0) evictOldest(keys.length - maxEntries + 1);
        write();
      } catch (e) {
        // Quota exceeded: drop the older half of our entries and try once more.
        try { evictOldest(Math.max(1, Math.ceil(storageKeys().length / 2))); write(); } catch (e2) { /* give up on persistence */ }
      }
    }
    function cacheClear() {
      memory.clear();
      storageKeys().forEach((k) => { try { storage.removeItem(k); } catch (e) { /* ignore */ } });
    }

    // ---------- one attempt ----------
    async function attempt(url, o, label) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const onCallerAbort = () => controller.abort();
      if (o.signal) o.signal.addEventListener('abort', onCallerAbort, { once: true });
      try {
        let res;
        try {
          res = await doFetch(url, o.method ? { method: o.method, body: o.body, headers: o.headers, signal: controller.signal } : { signal: controller.signal, headers: o.headers });
        } catch (e) {
          if (o.signal && o.signal.aborted) throw abortError();
          if (timedOut) throw new ServiceError('timeout', o.service, describe('timeout', label, { timeoutMs }), { url, timeoutMs });
          throw new ServiceError('network', o.service, describe('network', label), { url, cause: e });
        }
        if (!res.ok && !(o.okStatuses && o.okStatuses.indexOf(res.status) >= 0)) {
          const status = res.status;
          const kind = status === 429 ? 'rate-limit' : status >= 500 ? 'server' : 'http';
          let retryAfterMs = null;
          const ra = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
          if (ra && !isNaN(+ra)) retryAfterMs = +ra * 1000;
          throw new ServiceError(kind, o.service, describe(kind, label, { status }), { url, status, retryAfterMs });
        }
        try {
          return await res.json();
        } catch (e) {
          if (o.signal && o.signal.aborted) throw abortError();
          if (timedOut) throw new ServiceError('timeout', o.service, describe('timeout', label, { timeoutMs }), { url, timeoutMs });
          throw new ServiceError('bad-response', o.service, describe('bad-response', label), { url });
        }
      } finally {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener('abort', onCallerAbort);
      }
    }

    // ---------- public: GET JSON ----------
    // o: { service, label, ttlMs, cacheIf(json) -> bool, signal, minIntervalMs, headers,
    //      okStatuses (non-2xx statuses whose JSON body should be returned), silent (no onError),
    //      method + body (e.g. a JSON POST), cacheKey (cache under this key instead of the URL,
    //      e.g. to keep an API key out of storage or to include a POST body) }
    async function getJSON(url, o) {
      o = o || {};
      const label = o.label || o.service || 'The service';
      const ck = o.cacheKey || url;
      const cached = o.ttlMs ? cacheGet(ck) : null;
      if (cached && cached.fresh) return cached.value;

      const fail = (err) => {
        if (cached) return cached.value; // stale-if-error
        if (onError && !o.silent) { try { onError(err); } catch (e) { /* UI errors must not break callers */ } }
        throw err;
      };
      if (o.signal && o.signal.aborted) throw abortError();
      if (!isOnline()) return fail(new ServiceError('offline', o.service, describe('offline', label), { url }));

      let lastErr = null;
      for (let i = 0; i <= retries; i++) {
        if (i > 0) {
          let wait = backoffMs * Math.pow(2, i - 1) * (1 + Math.random() * 0.25);
          if (lastErr && lastErr.retryAfterMs) wait = Math.min(Math.max(wait, lastErr.retryAfterMs), 5000);
          await sleep(wait, o.signal);
        }
        if (o.minIntervalMs) {
          const t = now(), slot = Math.max(t, nextSlot[o.service] || 0);
          nextSlot[o.service] = slot + o.minIntervalMs;
          if (slot > t) await sleep(slot - t, o.signal);
        }
        try {
          const json = await attempt(url, o, label);
          if (o.ttlMs && (!o.cacheIf || o.cacheIf(json))) cacheSet(ck, json, o.ttlMs);
          return json;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          lastErr = e;
          if (!RETRYABLE.has(e.kind)) break;
        }
      }
      return fail(lastErr);
    }

    return { getJSON, cache: { get: cacheGet, set: cacheSet, clear: cacheClear }, ServiceError };
  }

  return { create, ServiceError };
});
