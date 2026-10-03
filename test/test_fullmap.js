// Full-screen map layout (src/map.js qflowFullMapLayout) on a tiny fake DOM.
// Checks: the map frame moves into the full-screen layer, every other block moves
// unchanged and in order into the bottom panel, scripts and fixed overlays stay,
// panel states, and that every map page has a frame the layout recognises.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.id = attrs.id || ''; this._cls = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.fixed = !!attrs.fixed; this.dataset = {}; this.style = { setProperty() {} }; this.attrs = {}; this.listeners = {};
    const self = this;
    this.classList = {
      contains: (c) => self._cls.has(c), add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c),
      toggle: (c, on) => { (on === undefined ? !self._cls.has(c) : on) ? self._cls.add(c) : self._cls.delete(c); }
    };
  }
  set className(v) { this._cls = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set innerHTML(v) { this._html = v; }
  _detach() { if (this.parentElement) { const p = this.parentElement; p.children = p.children.filter((c) => c !== this); this.parentElement = null; } }
  appendChild(n) { n._detach(); n.parentElement = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(n)); }
  prepend(...ns) { ns.reverse().forEach((n) => { n._detach(); n.parentElement = this; this.children.unshift(n); }); }
  after(...ns) {
    const p = this.parentElement; let i = p.children.indexOf(this);
    ns.forEach((n) => { n._detach(); i = p.children.indexOf(this) + 1 + ns.indexOf(n); n.parentElement = p; p.children.splice(i, 0, n); });
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { this.listeners[t] = f; }
  getBoundingClientRect() { return { height: 300 }; }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find(pred); if (r) return r; } return null; }
}

function page({ withFixed = true } = {}) {
  const body = new El('body');
  const nav = body.appendChild(new El('nav', { id: 'nav', class: 'nav' }));
  const main = body.appendChild(new El('main', { class: 'page' }));
  const title = main.appendChild(new El('div', { class: 'page-title' }));
  const grid = main.appendChild(new El('section', { class: 'planner' }));
  const form = grid.appendChild(new El('div', { class: 'form-card', id: 'form' }));
  const frame = grid.appendChild(new El('div', { class: 'map-frame' }));
  frame.appendChild(new El('div', { class: 'map-frame-head' }));
  const box = frame.appendChild(new El('div', { class: 'map-box', id: 'planMap' }));
  frame.appendChild(new El('div', { class: 'map-legend' }));
  const modal = withFixed ? body.appendChild(new El('div', { class: 'nav-sim-modal', fixed: true })) : null;
  const footer = body.appendChild(new El('footer'));
  const script = body.appendChild(new El('script'));
  const all = [body, nav, main, title, grid, form, frame, box, footer, script].concat(modal ? [modal] : []);
  const document = {
    body, documentElement: new El('html'),
    getElementById: (id) => body.find((e) => e.id === id),
    createElement: (t) => new El(t)
  };
  const ctx = {
    document, console,
    window: { getComputedStyle: (el) => ({ position: el.fixed ? 'fixed' : 'static' }), addEventListener() {} },
    L: { point: (x, y) => (Array.isArray(x) ? { x: x[0], y: x[1] } : typeof x === 'object' ? x : { x, y }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'map.js'), 'utf8'), ctx);
  return { ctx, body, nav, main, title, grid, form, frame, box, modal, footer, script, all };
}

console.log('--- Full-screen map layout ---');
{
  const t = page();
  const v = t.ctx.qflowFullMapLayout('planMap');
  assert.ok(v, 'layout applied');
  const [c0, c1, c2] = t.body.children;
  assert.strictEqual(c0, t.nav, 'top bar stays first');
  assert.ok(c1.classList.contains('qf-mapview') && c2.classList.contains('qf-sheet'), 'map layer, then bottom panel');
  assert.strictEqual(t.frame.parentElement, c1, 'map frame (head, map, legend) is in the full-screen layer');
  assert.strictEqual(t.box.parentElement, t.frame, 'map box keeps its frame and id');
  const sheetBody = c2.children[1];
  assert.ok(sheetBody.classList.contains('qf-sheet-body'));
  assert.deepStrictEqual(sheetBody.children, [t.main, t.footer], 'other blocks moved in their original order');
  assert.deepStrictEqual(t.grid.children, [t.form], 'cards stay inside their own containers');
  assert.strictEqual(t.modal.parentElement, t.body, 'fixed overlays (modals) are not moved');
  assert.strictEqual(t.script.parentElement, t.body, 'scripts are not moved');
  assert.ok(t.body.classList.contains('qf-fullmap'));
  assert.strictEqual(c2.dataset.state, 'half', 'panel starts at half height');

  // Tap the handle: half -> full -> half.
  const handle = c2.children[0];
  handle.listeners.click(); assert.strictEqual(c2.dataset.state, 'full');
  assert.ok(t.body.classList.contains('qf-sheet-full'));
  handle.listeners.click(); assert.strictEqual(c2.dataset.state, 'half');

  // Only once per page, and only for real map frames.
  assert.strictEqual(t.ctx.qflowFullMapLayout('planMap'), null, 'not applied twice');
}
{
  const t = page();
  t.box.parentElement.classList.remove('map-frame');
  assert.strictEqual(t.ctx.qflowFullMapLayout('planMap'), null, 'maps outside a .map-frame (e.g. the drive simulation) are left alone');
  assert.strictEqual(t.box.parentElement, t.frame);
}
{
  // fitBounds keeps the bounds above the panel.
  const t = page();
  const v = t.ctx.qflowFullMapLayout('planMap');
  let got = null;
  const map = { fitBounds: (b, o) => { got = o; }, getSize: () => ({ y: 800 }) };
  t.ctx.qflowFitAboveSheet(map, v);
  map.fitBounds([[0, 0], [1, 1]], { padding: [40, 40] });
  assert.deepStrictEqual(got.paddingTopLeft, { x: 40, y: 40 });
  assert.deepStrictEqual(got.paddingBottomRight, { x: 40, y: 340 }, 'bottom padding includes the panel height');
}

// Every page that builds a map uses a .map-frame > .map-box container.
for (const f of ['index.html', 'plan.html', 'results.html', 'vrp.html', 'network.html']) {
  const html = fs.readFileSync(path.join(SRC, f), 'utf8');
  const m = html.match(/qflowBuildMap\('([^']+)'/);
  assert.ok(m, f + ' builds a map');
  const re = new RegExp('class="map-frame"[\\s\\S]{0,600}?<div class="map-box" id="' + m[1] + '"');
  assert.ok(re.test(html), f + ': #' + m[1] + ' sits directly in a .map-frame');
}
const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
for (const sel of ['.qf-mapview', '.qf-sheet[data-state="min"]', '.qf-sheet[data-state="full"]', '.qf-sheet-handle', '.qf-mapview .leaflet-bottom'])
  assert.ok(css.includes(sel), 'style.css styles ' + sel);

console.log('✓ map fills the screen; other blocks move unchanged and in order into the bottom panel (scripts and overlays stay); half/full panel; fitBounds stays above the panel; all 5 map pages qualify.');
