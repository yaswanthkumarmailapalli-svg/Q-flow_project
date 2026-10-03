// Checks a TomTom API key against the TomTom services Q-FLOW uses (map, traffic, incidents, routing, navigation, matrix).
//   node scripts/check-tomtom.js            (key from QFLOW_TOMTOM_KEY or the file .tomtom-key)
//   node scripts/check-tomtom.js 17.385 78.4867   (optional test location: lat lng; default Hyderabad)
// Prints each service's HTTP status and what Q-FLOW understood from the answer.
// The key is never printed. Needs Node 18+ (built-in fetch) and internet access.
const fs = require('fs'), path = require('path');
const T = require('../src/traffic-live.js');
const NR = require('../src/nav-routing.js');

const keyFile = path.join(__dirname, '..', '.tomtom-key');
const key = (process.env.QFLOW_TOMTOM_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!T.validKey(key)) {
  console.error('No valid TomTom key. Set QFLOW_TOMTOM_KEY or put the key (only) in .tomtom-key in the project folder.');
  process.exit(2);
}
const lat = parseFloat(process.argv[2]) || 17.385, lng = parseFloat(process.argv[3]) || 78.4867;
const BASE = 'https://api.tomtom.com';
const hide = (s) => String(s).split(key).join('***');

async function call(name, url, init, understand) {
  try {
    const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, init));
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* tiles are images */ }
    const note = res.ok ? understand(json, res) : hide(text).slice(0, 160);
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${name}: HTTP ${res.status}${note ? ' · ' + note : ''}`);
    return res.ok;
  } catch (e) {
    console.log(`FAIL ${name}: ${hide(e.message)}`);
    return false;
  }
}

(async () => {
  console.log(`Testing TomTom near ${lat}, ${lng} …`);
  // Tile covering the point at zoom 12.
  const z = 12, n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const results = [];
  results.push(await call('Traffic flow tile', T.flowTileUrl(BASE, key, 'relative0').replace('{z}', z).replace('{x}', x).replace('{y}', y), {},
    (j, res) => (res.headers.get('content-type') || '') + ' image'));
  results.push(await call('Map tile (Map Display API)', `${BASE}/map/1/tile/basic/main/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}&tileSize=256`, {},
    (j, res) => (res.headers.get('content-type') || '') + ' image'));
  results.push(await call('Incident details', T.incidentsUrl(BASE, key, T.bboxAround(lat, lng, 10)), {},
    (j) => { const l = T.parseIncidents(j); return `${l.length} incident(s) within ~10 km` + (l[0] ? ` (first: ${l[0].category}${l[0].road ? ', ' + l[0].road : ''})` : ''); }));
  const a = { lat, lng }, b = { lat: lat + 0.03, lng: lng + 0.03 };
  results.push(await call('Live route time', T.routeUrl(BASE, key, [a, b]), {},
    (j) => { const s = T.parseRouteSummary(j); return s ? `${s.travelMin.toFixed(1)} min now, ${s.delayMin === null ? '?' : s.delayMin.toFixed(1)} min of it traffic` : 'no summary'; }));
  // Navigation route: guidance instructions parsed by src/nav-routing.js (turn-by-turn).
  const navProvider = NR.tomtomProvider({ key: () => key, baseUrl: () => BASE, getJSON: async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) { const e = new Error('HTTP ' + r.status + ' ' + hide((await r.text()).slice(0, 120))); e.status = r.status; throw e; } return r.json(); } });
  try {
    const routes = await navProvider.getRoutes(a, b, { headingDeg: 45 });
    const st = routes[0].steps;
    console.log(`OK   Navigation route: ${(routes[0].lengthM / 1000).toFixed(1)} km, ${st.length} turn-by-turn steps (first: "${st[1] ? st[1].text : st[0].text}")`);
    results.push(true);
  } catch (e) { console.log('FAIL Navigation route: ' + hide(e.message)); results.push(false); }
  const nodes = [a, b, { lat: lat - 0.02, lng: lng + 0.01 }];
  results.push(await call('Matrix (live)', `${BASE}/routing/matrix/2?key=${encodeURIComponent(key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(T.matrixBody(nodes, { o: [0, 3], d: [0, 3] })) },
    (j) => { const ok = (j && j.data || []).filter((c) => c.routeSummary).length; return `${ok} of 9 cells routed`; }));
  const good = results.filter(Boolean).length;
  console.log(`\n${good} of 6 checks pass with this key.` + (good < 6 ? ' 403 = key not enabled for that API or wrong key; 429 = daily limit reached.' : ' Live traffic and TomTom navigation routing should work.'));
  process.exit(good === 6 ? 0 : 1);
})();
