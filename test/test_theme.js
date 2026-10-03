// Theme system checks: layered palette, comfortable contrast, accents, switching (node only).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter((f) => /\.(css|html|js)$/.test(f) && !/^vrp-(engine|extras)\.js$/.test(f));
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const css = read('style.css');
const ui = read('ui.js');

// ---------- helpers ----------
function rgbOf(lit) {
  let m = lit.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
  m = lit.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = lit.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [m[1], m[2], m[3]].map(Number);
  return null;
}
function lum(hex) {
  const c = rgbOf(hex).map((v) => v / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function block(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i >= 0, 'missing block ' + selector);
  const body = css.slice(i + selector.length + 2, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

console.log('--- Theme palette ---');

// 1. Colour literals live only in the token section of style.css and the accent table in ui.js.
const tokStart = css.indexOf('/* ---------- THEME TOKENS'), tokEnd = css.indexOf(':root {\n  --font-sans');
assert.ok(tokStart >= 0 && tokEnd > tokStart, 'token section');
const accStart = ui.indexOf('const QFLOW_ACCENTS = {'), accEnd = ui.indexOf('};', accStart);
const outside = [];
for (const f of files) {
  let src = read(f).replace(/&#\d+;|&#x[0-9a-f]+;/gi, '');
  if (f === 'style.css') src = src.slice(0, tokStart) + src.slice(tokEnd);
  if (f === 'ui.js') src = src.slice(0, accStart) + src.slice(accEnd);
  for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) {
    const rgb = rgbOf(m[0]);
    if (rgb && Math.max(...rgb) - Math.min(...rgb) > 2) outside.push(`${f}: ${m[0]}`);
  }
}
assert.deepStrictEqual(outside, [], 'colours must come from theme tokens: ' + outside.join(', '));
assert.doesNotMatch(css, /gradient\(/, 'no CSS gradients');
assert.doesNotMatch(css, /fonts\.googleapis|@import/, 'no external web fonts');

// 2. Layered surfaces in both themes; nothing pure black / pure white for page or text.
const dark = block(':root, [data-theme="dusk"]'), light = block('[data-theme="day"]');
const NEED = ['--bg', '--surface2', '--surface', '--raised', '--input', '--nav', '--text', '--text-bright', '--muted', '--muted2', '--disabled',
  '--line', '--border', '--line-strong', '--success', '--warn', '--danger', '--inverse-bg', '--inverse-text', '--shadow', '--shadow-lg', '--tile-filter'];
for (const [name, t] of [['dark', dark], ['light', light]]) {
  for (const k of NEED) assert.ok(t[k], `${name} defines ${k}`);
  const layers = ['--bg', '--surface2', '--surface', '--input'].map((k) => t[k].toLowerCase());
  assert.strictEqual(new Set(layers).size, layers.length, `${name}: background, secondary, card and input surfaces are distinct (${layers})`);
  for (const k of ['--bg', '--text', '--text-bright']) assert.ok(!['#000000', '#ffffff', '#000', '#fff'].includes(t[k].toLowerCase()), `${name} ${k} is not pure black/white`);
  const surfaces = ['--bg', '--surface2', '--surface', '--raised', '--input'].map((k) => t[k]);
  for (const s of surfaces) {
    const c = contrast(t['--text'], s);
    assert.ok(c >= 7 && c <= 16, `${name}: body text contrast ${c.toFixed(1)} on ${s} is comfortable (7-16)`);
    assert.ok(contrast(t['--muted'], s) >= 4.5, `${name}: secondary text on ${s}`);
    assert.ok(contrast(t['--line-strong'], s) >= 3, `${name}: control borders on ${s}`);
  }
  for (const k of ['--muted2', '--success', '--warn', '--danger']) {
    for (const s of ['--bg', '--surface2', '--surface']) assert.ok(contrast(t[k], t[s]) >= 4.5, `${name}: ${k} text on ${s}`);
  }
  assert.ok(contrast(t['--inverse-text'], t['--inverse-bg']) >= 7, `${name}: toast / offline bar text`);
}
assert.ok(lum(dark['--surface']) > lum(dark['--bg']) && lum(dark['--raised']) > lum(dark['--surface']), 'dark: elevation by lighter surfaces');
assert.notStrictEqual(light['--shadow'], 'none', 'light: soft shadows for elevation');

// 3. Accents: CSS tokens per theme, contrast, and the ui.js swatch table matches.
const accents = vm.runInNewContext('(' + ui.slice(accStart + 'const QFLOW_ACCENTS = '.length, accEnd + 1) + ')');
assert.strictEqual(Object.keys(accents).length, 7);
for (const [key, a] of Object.entries(accents)) {
  const d = key === 'blue' ? block(':root, [data-accent="blue"]') : block(`[data-accent="${key}"]`);
  const l = key === 'blue' ? block('[data-theme="day"], [data-theme="day"][data-accent="blue"]') : block(`[data-theme="day"][data-accent="${key}"]`);
  assert.strictEqual(d['--accent'].toLowerCase(), a.dark, `${key}: dark swatch matches CSS`);
  assert.strictEqual(l['--accent'].toLowerCase(), a.light, `${key}: light swatch matches CSS`);
  for (const [t, v] of [[dark, d], [light, l]]) {
    assert.ok(contrast(v['--on-accent'], v['--accent']) >= 4.5, `${key}: text on accent buttons`);
    for (const s of ['--bg', '--surface2', '--surface', '--raised', '--input']) {
      assert.ok(contrast(v['--accent-text'], t[s]) >= 4.5, `${key}: accent text on ${s}`);
      assert.ok(contrast(v['--accent'], t[s]) >= 3, `${key}: accent shapes on ${s}`);
    }
  }
}
assert.match(css, /--fg: var\(--accent\)/, 'legacy emphasis token maps to the accent');

// 4. Map vector layers always carry a theme class (Leaflet's default stroke is blue).
const unclassed = [];
for (const f of files.filter((x) => /\.(html|js)$/.test(x))) {
  for (const m of read(f).matchAll(/L\.(polyline|circleMarker|circle)\(([\s\S]*?)\)\s*\.(addTo|bindPopup)/g)) {
    if (!/className/.test(m[2])) unclassed.push(`${f}: L.${m[1]}`);
  }
}
assert.deepStrictEqual(unclassed, [], 'vector layers without className: ' + unclassed.join(', '));

// 5. Every page applies theme + accent before first paint and has the shared nav structure.
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const html = read(f), head = html.split('</head>')[0];
  assert.match(head, /Theme before first paint[\s\S]*data-accent/, `${f}: early theme + accent script`);
  assert.ok(head.indexOf('Theme before first paint') < head.indexOf('style.css'), `${f}: theme set before the stylesheet`);
  assert.match(html, /<div class="nav-menu" id="navMenu">/, `${f}: nav-menu`);
  assert.match(html, /class="hamburger"[^>]*aria-controls="navMenu"[^>]*aria-expanded="false"/, `${f}: accessible hamburger`);
  assert.match(html, /<button class="theme-toggle"[^>]*aria-label=/, `${f}: labelled appearance button`);
}
console.log('✓ layered surfaces in both themes, comfortable contrast (body text 7-16:1), 7 accents pass AA in both themes, colours only from tokens, every map line classed.');

// 6. Theme / accent logic in ui.js with a tiny DOM stand-in.
console.log('\n--- Theme switching ---');
function runUi({ stored, accent, systemLight }) {
  const store = new Map();
  if (stored) store.set('qflowTheme', stored);
  if (accent) store.set('qflowAccent', accent);
  const attrs = {};
  const label = { textContent: '' };
  const btn = { attrs: {}, title: '', onclick: null, querySelector: () => label, setAttribute(k, v) { this.attrs[k] = v; } };
  const events = [];
  const accentOf = () => { const a = attrs['data-accent'] || 'blue'; const day = attrs['data-theme'] === 'day'; return day ? accents[a].light : accents[a].dark; };
  const ctx = {
    console, Math, JSON, Date, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] || null, get length() { return store.size; } },
    document: {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] || null },
      querySelectorAll: (sel) => (sel === '.theme-toggle' ? [btn] : []),
      getElementById: () => null, addEventListener() {}
    },
    getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--accent' ? accentOf() : '') }),
    matchMedia: (q) => ({ matches: /light/.test(q) ? !!systemLight : false, addEventListener() {} }),
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    AudioContext: undefined
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.dispatchEvent = (e) => events.push(e);
  vm.createContext(ctx);
  vm.runInContext(ui, ctx, { filename: 'ui.js' });
  return { ctx, attrs, store, btn, events };
}

{
  const t = runUi({ systemLight: true });
  assert.strictEqual(t.attrs['data-theme'], 'day', 'no stored choice: follows a light system preference');
  assert.strictEqual(t.attrs['data-accent'], 'blue', 'default accent');
  assert.strictEqual(vm.runInContext('qflowThemePreference()', t.ctx), 'system');
  assert.match(t.btn.attrs['aria-label'], /Appearance: light theme, blue accent/);
  vm.runInContext("qflowSetThemePreference('dusk')", t.ctx);
  assert.strictEqual(t.attrs['data-theme'], 'dusk');
  assert.strictEqual(t.store.get('qflowTheme'), 'dusk', 'explicit choice is stored');
  vm.runInContext("qflowSetThemePreference('system')", t.ctx);
  assert.strictEqual(t.store.has('qflowTheme'), false, '"System" removes the stored choice');
  assert.strictEqual(t.attrs['data-theme'], 'day', 'and follows the system again');
  vm.runInContext("qflowSetAccent('teal')", t.ctx);
  assert.strictEqual(t.attrs['data-accent'], 'teal');
  assert.strictEqual(t.store.get('qflowAccent'), 'teal', 'accent is stored');
  assert.ok(t.events.some((e) => e.type === 'qflow:themechange' && e.detail.accent === 'teal'), 'accent change fires the theme event');
  assert.strictEqual(vm.runInContext('qflowSeries(0).color', t.ctx), accents.teal.light, 'highlighted series uses the current accent');
  vm.runInContext("qflowSetAccent('neon')", t.ctx);
  assert.strictEqual(t.attrs['data-accent'], 'blue', 'unknown accent falls back to the default');
  vm.runInContext('qflowToggleTheme()', t.ctx);
  assert.strictEqual(t.attrs['data-theme'], 'dusk', 'quick toggle still switches light/dark');
}
{
  const t = runUi({ stored: 'day', accent: 'rose', systemLight: false });
  assert.strictEqual(t.attrs['data-theme'], 'day', 'stored choice wins over the system preference');
  assert.strictEqual(t.attrs['data-accent'], 'rose', 'stored accent restored');
}
{
  const t = runUi({ systemLight: false });
  assert.strictEqual(t.attrs['data-theme'], 'dusk', 'dark when the system is dark and nothing is stored');
}
{
  const t = runUi({ stored: 'day', accent: 'teal' });
  for (const [k, v] of [['qflowHistory', '[{"label":"Home"}]'], ['qflowSaved', '{}'], ['qflowLocLat', '17.4'], ['qflowFrom', 'Home'],
    ['qflowCache:https://nominatim.example/reverse?lat=17.4&lon=78.5', '{}'], ['qflowLang', 'te'], ['qflowMode', 'judge']]) t.store.set(k, v);
  const removed = vm.runInContext('qflowClearPersonalData()', t.ctx);
  assert.strictEqual(removed, 5, 'four personal keys + one cached lookup removed');
  for (const k of ['qflowHistory', 'qflowSaved', 'qflowLocLat', 'qflowFrom']) assert.ok(!t.store.has(k), `${k} cleared`);
  assert.ok(![...t.store.keys()].some((k) => k.startsWith('qflowCache:')), 'cached lookups (contain coordinates) cleared');
  for (const k of ['qflowTheme', 'qflowAccent', 'qflowLang', 'qflowMode']) assert.ok(t.store.has(k), `${k} preference kept`);
}
console.log('✓ System / Light / Dark preference (stored, or following the device), accent stored with fallback, change event, highlighted series follows the accent; clearing personal data keeps preferences.');
