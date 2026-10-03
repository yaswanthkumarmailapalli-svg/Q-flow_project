// net.js checks: timeout, retry/backoff, error messages, cache + TTL, throttle.
// Node only: fetch, storage and the clock are faked; no network access.
const assert = require('assert');
const QFlowNet = require('../src/net.js');

const ok = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => (typeof body === 'function' ? body() : body)
});
// fetch stub driven by a list of behaviours, one per call.
function scriptedFetch(steps) {
  const calls = [];
  const fn = (url, init) => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    }
    if (step === 'neterr') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(step);
  };
  fn.calls = calls;
  return fn;
}
function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m
  };
}
// Node exits with code 0 if pending promises can never settle (e.g. a request that
// is never aborted), so require the suite to reach its last line.
let finished = false;
process.on('exit', () => { if (!finished) { console.error('✗ net.js tests did not finish (a request never settled: timeout/abort broken?)'); process.exitCode = 1; } });
const base = (o) => Object.assign({ timeoutMs: 60, backoffMs: 5, storage: null, isOnline: () => true }, o);

(async () => {
  console.log('--- net.js ---');

  // 1. Timeout: each attempt is aborted after timeoutMs; one retry; then a timeout error.
  {
    const f = scriptedFetch(['hang']);
    const errors = [];
    const net = QFlowNet.create(base({ fetch: f, onError: (e) => errors.push(e) }));
    const t0 = Date.now();
    await assert.rejects(net.getJSON('https://osrm/x', { service: 'osrm', label: 'The route service (OSRM)' }), (e) => {
      assert.strictEqual(e.kind, 'timeout');
      assert.match(e.userMessage, /The route service \(OSRM\) did not respond within/);
      return true;
    });
    assert.strictEqual(f.calls.length, 2, 'one retry after a timeout');
    assert.ok(Date.now() - t0 >= 120, 'both attempts waited for the timeout');
    assert.strictEqual(errors.length, 1, 'onError (status bar) is called once, after the retry');
  }

  // 2. Retry once on 503, then succeed.
  {
    const f = scriptedFetch([ok({}, 503), ok({ code: 'Ok' })]);
    const net = QFlowNet.create(base({ fetch: f }));
    assert.deepStrictEqual(await net.getJSON('u', { service: 's' }), { code: 'Ok' });
    assert.strictEqual(f.calls.length, 2);
  }

  // 3. No retry on a plain 4xx; message explains the rejection.
  {
    const f = scriptedFetch([ok({}, 404)]);
    const net = QFlowNet.create(base({ fetch: f }));
    await assert.rejects(net.getJSON('u', { service: 's', label: 'X' }), (e) => e.kind === 'http' && e.status === 404 && /rejected the request \(HTTP 404\)/.test(e.userMessage));
    assert.strictEqual(f.calls.length, 1);
  }

  // 4. 429 is retried; network errors are retried; then give up with a clear message.
  {
    const f = scriptedFetch([ok({}, 429, { 'Retry-After': '0' }), 'neterr']);
    const net = QFlowNet.create(base({ fetch: f }));
    await assert.rejects(net.getJSON('u', { service: 's', label: 'Place search (Photon)' }), (e) => e.kind === 'network' && /Could not reach Place search \(Photon\)/.test(e.userMessage));
    assert.strictEqual(f.calls.length, 2);
  }

  // 5. okStatuses: OSRM-style 400 with a JSON body is returned, not thrown.
  {
    const f = scriptedFetch([ok({ code: 'NoRoute' }, 400)]);
    const net = QFlowNet.create(base({ fetch: f }));
    assert.deepStrictEqual(await net.getJSON('u', { service: 'osrm', okStatuses: [400] }), { code: 'NoRoute' });
  }

  // 6. Unreadable JSON -> bad-response, not retried.
  {
    const f = scriptedFetch([ok(() => { throw new SyntaxError('bad'); })]);
    const net = QFlowNet.create(base({ fetch: f }));
    await assert.rejects(net.getJSON('u', { service: 's' }), (e) => e.kind === 'bad-response');
    assert.strictEqual(f.calls.length, 1);
  }

  // 7. Offline: no request, clear message.
  {
    const f = scriptedFetch([ok({})]);
    const net = QFlowNet.create(base({ fetch: f, isOnline: () => false }));
    await assert.rejects(net.getJSON('u', { service: 's', label: 'The route service (OSRM)' }), (e) => e.kind === 'offline' && /No internet connection/.test(e.userMessage));
    assert.strictEqual(f.calls.length, 0);
  }

  // 8. Caller abort: rejects with AbortError, no retry, no status-bar message.
  {
    const f = scriptedFetch(['hang']);
    const errors = [];
    const net = QFlowNet.create(base({ fetch: f, timeoutMs: 5000, onError: (e) => errors.push(e) }));
    const ctl = new AbortController();
    const p = net.getJSON('u', { service: 's', signal: ctl.signal });
    const t0 = Date.now();
    setTimeout(() => ctl.abort(), 10);
    await assert.rejects(p, (e) => e.name === 'AbortError');
    assert.ok(Date.now() - t0 < 500, 'cancelling stops the in-flight request immediately (not at the timeout)');
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(errors.length, 0);
  }

  // 9. Cache: memory + localStorage, keyed by URL, TTL respected, cacheIf honoured.
  {
    let clock = 1000;
    const store = fakeStorage();
    const f = scriptedFetch([ok({ n: 1 }), ok({ n: 2 }), ok({ n: 3 })]);
    const mk = () => QFlowNet.create(base({ fetch: f, storage: store, now: () => clock }));
    const net = mk();
    const o = { service: 'nominatim', ttlMs: 1000 };
    assert.deepStrictEqual(await net.getJSON('https://geo/a', o), { n: 1 });
    assert.deepStrictEqual(await net.getJSON('https://geo/a', o), { n: 1 }, 'second call served from cache');
    assert.strictEqual(f.calls.length, 1);
    assert.ok(store.getItem('qflowCache:https://geo/a'), 'persisted to localStorage');
    assert.deepStrictEqual(await mk().getJSON('https://geo/a', o), { n: 1 }, 'a fresh instance (page reload) reads localStorage');
    assert.strictEqual(f.calls.length, 1);
    clock += 1001;
    assert.deepStrictEqual(await net.getJSON('https://geo/a', o), { n: 2 }, 'refetched after TTL');
    assert.strictEqual(f.calls.length, 2);
    const g = scriptedFetch([ok({ code: 'NoRoute' }), ok({ code: 'Ok' })]);
    const net2 = QFlowNet.create(base({ fetch: g, storage: fakeStorage() }));
    const o2 = { service: 'osrm', ttlMs: 1e6, cacheIf: (d) => d.code === 'Ok' };
    await net2.getJSON('r', o2); await net2.getJSON('r', o2); await net2.getJSON('r', o2);
    assert.strictEqual(g.calls.length, 2, 'failed lookups are not cached; successful ones are');
  }

  // 10. Stale-if-error: an expired entry is served when the service is down.
  {
    let clock = 0;
    const f = scriptedFetch([ok({ v: 'old' }), 'neterr', 'neterr']);
    const errors = [];
    const net = QFlowNet.create(base({ fetch: f, now: () => clock, onError: (e) => errors.push(e) }));
    await net.getJSON('u', { service: 's', ttlMs: 10 });
    clock = 100;
    assert.deepStrictEqual(await net.getJSON('u', { service: 's', ttlMs: 10 }), { v: 'old' });
    assert.strictEqual(errors.length, 0, 'serving stale data is not reported as an error');
  }

  // 11. Storage limits: oversized entries stay in memory; entry count is capped.
  {
    const store = fakeStorage();
    const f = scriptedFetch([ok({ big: 'x'.repeat(5000) }), ok({ s: 1 })]);
    const net = QFlowNet.create(base({ fetch: f, storage: store, maxEntryBytes: 1000, maxEntries: 3 }));
    await net.getJSON('big', { service: 's', ttlMs: 1e6 });
    assert.strictEqual(store.getItem('qflowCache:big'), null);
    for (let i = 0; i < 5; i++) net.cache.set('k' + i, { i }, 1e6);
    assert.ok([...store._m.keys()].filter((k) => k.startsWith('qflowCache:')).length <= 3);
  }

  // 12. minIntervalMs spaces out requests to the same service (Nominatim 1 req/s policy).
  {
    const f = scriptedFetch([ok({}), ok({})]);
    const net = QFlowNet.create(base({ fetch: f }));
    const t0 = Date.now();
    await Promise.all([net.getJSON('a', { service: 'n', minIntervalMs: 80 }), net.getJSON('b', { service: 'n', minIntervalMs: 80 })]);
    assert.ok(Date.now() - t0 >= 75, 'second request waited for the interval');
  }

  finished = true;
  console.log('✓ timeout + retry, error messages, abort, offline, cache/TTL/stale, storage limits and throttle verified.');
})().catch((e) => { console.error(e); process.exit(1); });
