/* =========================================================
   Q-FLOW — UI: CANVAS BACKGROUND, SOUND, TOASTS, THEME & NAV CHROME
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: i18n.js at call time (qflowInitChrome -> qflowApplyLang).
   ========================================================= */

/* ---------- AMBIENT CANVAS BACKGROUND (decorative) ---------- */
(function initQuantumCanvas() {
  window.addEventListener('DOMContentLoaded', () => {
    // Decorative only: skipped when the user prefers reduced motion.
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let canvas = document.getElementById('quantumCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'quantumCanvas';
      document.body.prepend(canvas);
    }
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const numNodes = Math.min(45, Math.floor((width * height) / 25000));
    const nodes = [];
    for (let i = 0; i < numNodes; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 2 + 1.2,
        phase: Math.random() * Math.PI * 2
      });
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      const isDay = document.documentElement.getAttribute('data-theme') === 'day';
      const nodeColor = isDay ? 'rgba(0, 0, 0, ' : 'rgba(255, 255, 255, ';
      const lineColor = nodeColor;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor + '0.5)';
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n.x - n2.x;
          const dy = n.y - n2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(n2.x, n2.y);
            const alpha = (1 - dist / 130) * 0.18;
            ctx.strokeStyle = lineColor + alpha + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
})();

/* ---------- WEB AUDIO SYNTHESIZER (SOUND FX) ---------- */
class QFlowAudio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('qflowSound') !== 'false';
  }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('qflowSound', this.enabled);
    return this.enabled;
  }
  playQuantumSweep() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const now = this.ctx.currentTime;
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.35);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }
  playClick() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const now = this.ctx.currentTime;
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }
  playAlert() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [440, 554, 659].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.05, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.15);
      });
    } catch (e) {}
  }
}
const qflowAudio = new QFlowAudio();

/* ---------- TOAST NOTIFICATIONS ---------- */
function qflowToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icons = { info: '⚡', success: '✓', alert: '🚨', warn: '⚠' };
  // Built with DOM nodes: messages can contain place names or voice-search text.
  const icon = document.createElement('span');
  icon.style.fontSize = '16px';
  icon.textContent = icons[type] || '⚡';
  const body = document.createElement('div');
  body.textContent = String(message);
  toast.append(icon, ' ', body);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ---------- THEME, ACCENT & APPEARANCE MENU ----------
   Theme: 'dusk' (dark) or 'day' (light). Preference stored in
   localStorage('qflowTheme'): 'day' | 'dusk', or absent = follow the system
   (prefers-color-scheme, followed live). Accent: localStorage('qflowAccent'),
   one of QFLOW_ACCENTS (default 'blue'), set as <html data-accent>.
   Each page's <head> applies both before first paint; this keeps them in sync.
   Any change dispatches 'qflow:themechange' so canvases can redraw. */
const QFLOW_DEFAULT_ACCENT = 'blue';
// Declared before the start-up block below runs (it may repaint the menu).
let _qflowAppearance = null;
let _qflowAppearanceOpener = null;
// Swatch previews for the Appearance menu; must match the [data-accent] tokens in style.css
// (test/test_theme.js checks this).
const QFLOW_ACCENTS = {
  blue: { name: 'Blue', light: '#1a73e8', dark: '#8ab4f8' },
  teal: { name: 'Teal', light: '#00796b', dark: '#6fd3c4' },
  green: { name: 'Green', light: '#188038', dark: '#81c995' },
  violet: { name: 'Violet', light: '#6750a4', dark: '#c9b8ff' },
  amber: { name: 'Amber', light: '#a85d00', dark: '#fdd663' },
  rose: { name: 'Rose', light: '#c2185b', dark: '#f48fb1' },
  graphite: { name: 'Graphite', light: '#3c4043', dark: '#e3e3e3' }
};

function qflowSystemTheme() {
  try {
    return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'dusk';
  } catch (e) {
    return 'dusk';
  }
}

function qflowStoredTheme() {
  const t = localStorage.getItem('qflowTheme');
  return t === 'day' || t === 'dusk' ? t : null;
}

// 'system' | 'day' | 'dusk'
function qflowThemePreference() {
  return qflowStoredTheme() || 'system';
}

function qflowCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'day' ? 'day' : 'dusk';
}

function qflowAccent() {
  const a = localStorage.getItem('qflowAccent');
  return Object.prototype.hasOwnProperty.call(QFLOW_ACCENTS, a) ? a : QFLOW_DEFAULT_ACCENT;
}

function _qflowThemeChanged() {
  _qflowPaintThemeToggles();
  if (typeof _qflowPaintAppearance === 'function') _qflowPaintAppearance();
  window.dispatchEvent(new CustomEvent('qflow:themechange', { detail: { theme: qflowCurrentTheme(), accent: qflowAccent() } }));
}

function _qflowPaintThemeToggles() {
  const isDay = qflowCurrentTheme() === 'day';
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    const label = b.querySelector('.theme-label');
    const text = 'Theme';
    if (label) label.textContent = text;
    else b.textContent = text;
    b.setAttribute('aria-label', 'Appearance: ' + (isDay ? 'light' : 'dark') + ' theme, ' + QFLOW_ACCENTS[qflowAccent()].name.toLowerCase() + ' accent');
    b.title = 'Appearance';
  });
}

function qflowApplyTheme(theme) {
  const t = theme === 'day' ? 'day' : 'dusk';
  const changed = qflowCurrentTheme() !== t;
  document.documentElement.setAttribute('data-theme', t);
  if (changed) _qflowThemeChanged();
  else _qflowPaintThemeToggles();
}

// pref: 'system' | 'day' | 'dusk'
function qflowSetThemePreference(pref) {
  if (pref === 'day' || pref === 'dusk') {
    localStorage.setItem('qflowTheme', pref);
    qflowApplyTheme(pref);
  } else {
    localStorage.removeItem('qflowTheme');
    qflowApplyTheme(qflowSystemTheme());
  }
  if (typeof _qflowPaintAppearance === 'function') _qflowPaintAppearance();
}

function qflowSetAccent(accent) {
  const a = Object.prototype.hasOwnProperty.call(QFLOW_ACCENTS, accent) ? accent : QFLOW_DEFAULT_ACCENT;
  localStorage.setItem('qflowAccent', a);
  const changed = document.documentElement.getAttribute('data-accent') !== a;
  document.documentElement.setAttribute('data-accent', a);
  if (changed) _qflowThemeChanged();
}

(function () {
  document.documentElement.setAttribute('data-accent', qflowAccent());
  qflowApplyTheme(qflowStoredTheme() || qflowSystemTheme());
  try {
    const mq = window.matchMedia && matchMedia('(prefers-color-scheme: light)');
    const follow = () => { if (!qflowStoredTheme()) qflowApplyTheme(qflowSystemTheme()); };
    if (mq && mq.addEventListener) mq.addEventListener('change', follow);
    else if (mq && mq.addListener) mq.addListener(follow);
  } catch (e) { /* no matchMedia */ }
})();

// Quick light/dark switch (kept for scripts and keyboard shortcuts).
function qflowToggleTheme() {
  qflowSetThemePreference(qflowCurrentTheme() === 'day' ? 'dusk' : 'day');
  qflowAudio.playClick();
}

/* Location-related data this device keeps (never sent anywhere by Q-FLOW itself).
   Preferences (theme, accent, language, view mode, sound) are kept. */
const QFLOW_PERSONAL_KEYS = ['qflowLocLabel', 'qflowLocLat', 'qflowLocLng', 'qflowHistory', 'qflowSaved',
  'qflowFrom', 'qflowFromLat', 'qflowFromLng', 'qflowTo', 'qflowToLat', 'qflowToLng', 'qflowStops',
  'qflowArriveTime', 'qflowEventMode', 'qflowLocRationale'];

// Removes saved places, trip history, last location and cached geocode / route
// responses (their URLs contain coordinates). Returns the number of items removed.
function qflowClearPersonalData() {
  let removed = 0;
  QFLOW_PERSONAL_KEYS.forEach((k) => {
    if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); removed++; }
  });
  const cacheKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('qflowCache:') === 0) cacheKeys.push(k);
  }
  cacheKeys.forEach((k) => { localStorage.removeItem(k); removed++; });
  if (typeof qflowNet !== 'undefined' && qflowNet.cache) qflowNet.cache.clear();
  return removed;
}

/* Appearance menu: theme mode (System / Light / Dark) + accent colour.
   A popover under the theme button on larger screens, a bottom sheet on phones. */

function _qflowRadioGroup(el) {
  // Arrow keys move the selection inside a radiogroup (WAI-ARIA radio pattern).
  el.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const items = Array.from(el.querySelectorAll('[role="radio"]'));
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + keys[e.key] + items.length) % items.length];
    next.focus();
    next.click();
  });
}

function _qflowBuildAppearance() {
  const p = document.createElement('div');
  p.className = 'appearance-panel';
  p.id = 'appearancePanel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-modal', 'false');
  p.setAttribute('aria-labelledby', 'apTitle');
  p.hidden = true;

  const head = document.createElement('div');
  head.className = 'ap-head';
  const h = document.createElement('h2');
  h.id = 'apTitle';
  h.textContent = 'Appearance';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ap-close';
  close.setAttribute('aria-label', 'Close appearance settings');
  close.textContent = '✕';
  close.onclick = () => qflowCloseAppearance(true);
  head.append(h, close);

  const modeLbl = document.createElement('div');
  modeLbl.className = 'ap-label';
  modeLbl.id = 'apModeLabel';
  modeLbl.textContent = 'Theme';
  const seg = document.createElement('div');
  seg.className = 'ap-seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-labelledby', 'apModeLabel');
  [['system', 'System'], ['day', 'Light'], ['dusk', 'Dark']].forEach(([val, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.pref = val;
    b.textContent = text;
    b.onclick = () => { qflowSetThemePreference(val); qflowAudio.playClick(); };
    seg.appendChild(b);
  });
  _qflowRadioGroup(seg);

  const accLbl = document.createElement('div');
  accLbl.className = 'ap-label';
  accLbl.id = 'apAccentLabel';
  accLbl.textContent = 'Accent colour';
  const sw = document.createElement('div');
  sw.className = 'ap-swatches';
  sw.setAttribute('role', 'radiogroup');
  sw.setAttribute('aria-labelledby', 'apAccentLabel');
  Object.entries(QFLOW_ACCENTS).forEach(([key, a]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ap-swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', a.name);
    b.title = a.name;
    b.dataset.accent = key;
    const dot = document.createElement('span');
    dot.className = 'ap-dot';
    dot.setAttribute('aria-hidden', 'true');
    b.appendChild(dot);
    b.onclick = () => { qflowSetAccent(key); qflowAudio.playClick(); };
    sw.appendChild(b);
  });
  _qflowRadioGroup(sw);

  const note = document.createElement('p');
  note.className = 'ap-note';
  note.textContent = 'Saved on this device. “System” follows your device’s light or dark setting.';

  const dataLbl = document.createElement('div');
  dataLbl.className = 'ap-label';
  dataLbl.textContent = 'Data on this device';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'secondary wide ap-clear';
  clear.textContent = 'Clear saved places, trips and location';
  clear.onclick = () => {
    if (!window.confirm('Remove saved places, recent trips, your last location and cached map lookups from this device? Theme and language settings are kept.')) return;
    const n = qflowClearPersonalData();
    qflowToast(n ? 'Saved places, trips and location data cleared.' : 'Nothing to clear.', 'success');
  };

  const live = _qflowBuildLiveSettings();

  p.append(head, modeLbl, seg, accLbl, sw, note, live, dataLbl, clear);
  document.body.appendChild(p);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !p.hidden) qflowCloseAppearance(true);
  });
  document.addEventListener('click', (e) => {
    if (p.hidden) return;
    if (p.contains(e.target) || (e.target.closest && e.target.closest('.theme-toggle'))) return;
    qflowCloseAppearance(false);
  });
  window.addEventListener('resize', () => { if (!p.hidden) _qflowPlaceAppearance(); });
  return p;
}

// Appearance > Live traffic: TomTom key and on/off switch (traffic-live.js). Changes reload
// the page, because maps and route times are set up when a page loads.
function _qflowBuildLiveSettings() {
  const box = document.createElement('div');
  box.className = 'ap-live';
  const lbl = document.createElement('div');
  lbl.className = 'ap-label';
  lbl.textContent = 'Live traffic (TomTom)';
  const status = document.createElement('p');
  status.className = 'ap-note';
  box.append(lbl, status);
  if (typeof QFlowLive === 'undefined' || typeof qflowLiveKey !== 'function') {
    status.textContent = 'Not available on this page.';
    return box;
  }
  const reload = (msg) => { qflowToast(msg + ' Reloading…', 'success'); setTimeout(() => location.reload(), 700); };
  const stored = localStorage.getItem(QFLOW_LIVE_KEY_STORAGE);
  const builtIn = !stored && !!qflowLiveKey();
  const key = qflowLiveKey();
  status.textContent = !key
    ? 'Off: traffic is simulated. Add a free TomTom API key (developer.tomtom.com) to show live traffic, real incidents and live travel times.'
    : (qflowLiveEnabled() ? 'On' : 'Paused') + (builtIn ? ': using the key included in this app build.' : ': using the key saved on this device.') +
      ' When on, map areas, your route and stops are sent to TomTom.';

  if (key) {
    const row = document.createElement('label');
    row.className = 'ap-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = qflowLiveEnabled();
    cb.onchange = () => { qflowSetLiveOn(cb.checked); reload(cb.checked ? 'Live traffic on.' : 'Live traffic off: simulated traffic.'); };
    row.append(cb, document.createTextNode(' Use live traffic'));
    box.appendChild(row);
  }
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'ap-key';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = key ? 'Replace TomTom API key' : 'Paste TomTom API key';
  input.setAttribute('aria-label', 'TomTom API key');
  const err = document.createElement('p');
  err.className = 'form-error';
  err.hidden = true;
  const btns = document.createElement('div');
  btns.className = 'ap-live-btns';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'secondary';
  save.textContent = 'Save key';
  save.onclick = () => {
    const v = input.value.trim();
    if (!qflowSetLiveKey(v) || !v) {
      err.textContent = 'That does not look like a TomTom API key (letters and numbers, usually 32 characters).';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    qflowSetLiveOn(true);
    reload('TomTom key saved.');
  };
  btns.appendChild(save);
  if (stored) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'secondary';
    rm.textContent = 'Remove key';
    rm.onclick = () => { qflowSetLiveKey(null); reload('TomTom key removed.'); };
    btns.appendChild(rm);
  }
  box.append(input, err, btns);
  return box;
}

function _qflowPaintAppearance() {
  const p = _qflowAppearance;
  if (!p) return;
  const pref = qflowThemePreference();
  p.querySelectorAll('.ap-seg [role="radio"]').forEach((b) => {
    const on = b.dataset.pref === pref;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  const acc = qflowAccent(), isDay = qflowCurrentTheme() === 'day';
  p.querySelectorAll('.ap-swatch').forEach((b) => {
    const on = b.dataset.accent === acc;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    const a = QFLOW_ACCENTS[b.dataset.accent];
    b.firstChild.style.background = isDay ? a.light : a.dark;
  });
}

function _qflowPlaceAppearance() {
  const p = _qflowAppearance, btn = _qflowAppearanceOpener;
  if (!p) return;
  if (window.innerWidth <= 599 || !btn) {
    p.classList.add('as-sheet');
    p.style.top = p.style.right = '';
    return;
  }
  p.classList.remove('as-sheet');
  const r = btn.getBoundingClientRect();
  p.style.top = Math.round(r.bottom + 8) + 'px';
  p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
}

function qflowOpenAppearance(btn) {
  if (!_qflowAppearance) _qflowAppearance = _qflowBuildAppearance();
  _qflowAppearanceOpener = btn || null;
  _qflowPaintAppearance();
  _qflowAppearance.hidden = false;
  _qflowPlaceAppearance();
  document.querySelectorAll('.theme-toggle').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  const first = _qflowAppearance.querySelector('.ap-seg [aria-checked="true"]');
  if (first) first.focus();
}

function qflowCloseAppearance(returnFocus) {
  if (!_qflowAppearance || _qflowAppearance.hidden) return;
  _qflowAppearance.hidden = true;
  document.querySelectorAll('.theme-toggle').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (returnFocus && _qflowAppearanceOpener) _qflowAppearanceOpener.focus();
}

function qflowToggleAppearance(btn) {
  if (_qflowAppearance && !_qflowAppearance.hidden) qflowCloseAppearance(true);
  else qflowOpenAppearance(btn);
}

/* ---------- DATA STYLES ----------
   Series 0 (QPSO, route A, vehicle 1) uses the accent; the rest are neutral
   greys told apart by shade, line weight and dash pattern. Colours are read from the theme's CSS
   variables at draw time (redraw on 'qflow:themechange'). */
function qflowCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const QFLOW_SERIES = [
  { shade: '--accent', width: 3, dash: [] },
  { shade: '--s2', width: 2.2, dash: [9, 5] },
  { shade: '--s2', width: 2.4, dash: [1.5, 4] },
  { shade: '--s3', width: 2.2, dash: [12, 4, 2, 4] },
  { shade: '--s3', width: 1.6, dash: [] },
  { shade: '--s4', width: 2.2, dash: [5, 3] },
  { shade: '--s4', width: 2, dash: [1, 3] },
  { shade: '--s2', width: 3, dash: [16, 6] }
];

// Style for series i: { color, dash (array, for canvas), dashArray (string, for Leaflet), width, cls }.
function qflowSeries(i) {
  const n = QFLOW_SERIES.length;
  const k = ((i % n) + n) % n;
  const s = QFLOW_SERIES[k];
  return { color: qflowCssVar(s.shade, '#888888'), dash: s.dash.slice(), dashArray: s.dash.length ? s.dash.join(' ') : null, width: s.width, cls: 'qf-series-' + k };
}

// Read a numeric form field and check its range. Marks the field aria-invalid and
// throws an Error with a plain-language message if it is not a usable number.
function qflowReadNumber(input, opts) {
  const v = parseFloat(String(input.value).trim());
  if (!Number.isFinite(v) || v < opts.min || v > opts.max) {
    input.setAttribute('aria-invalid', 'true');
    const err = new Error(`${opts.label} must be a number from ${opts.min} to ${opts.max}.`);
    err.code = 'bad-input';
    throw err;
  }
  input.removeAttribute('aria-invalid');
  return v;
}

// Markup for an error message shown in place of a result (message is escaped).
function qflowErrorHtml(err) {
  const msg = err && err.message ? err.message : 'Something went wrong. Please try again.';
  return '<div class="form-error" role="alert">⚠ ' + escapeHtml(msg) + '</div>';
}

// Fleet vehicles: a distinct colour per vehicle (--v1..--v8 in style.css) plus
// the series dash pattern, so routes stay distinguishable without colour too.
function qflowVehicleStyle(i) {
  const k = ((i % 8) + 8) % 8;
  const s = QFLOW_SERIES[k];
  return { color: qflowCssVar('--v' + (k + 1), '#808080'), dash: s.dash.slice(), dashArray: s.dash.length ? s.dash.join(' ') : null, width: Math.max(2.4, s.width), cls: 'qf-veh-' + k };
}

function qflowVehicleSwatch(i) {
  const k = ((i % 8) + 8) % 8;
  const s = QFLOW_SERIES[k];
  return '<svg class="qf-swatch" viewBox="0 0 28 8" aria-hidden="true" style="color:var(--v' + (k + 1) + ')">' +
    '<line x1="1" y1="4" x2="27" y2="4" stroke-width="' + Math.max(2.4, s.width) + '" stroke-linecap="round"' +
    (s.dash.length ? ' stroke-dasharray="' + s.dash.join(' ') + '"' : '') + '/></svg>';
}

// Size a canvas's drawing buffer to its rendered width (and the given CSS height)
// at the device pixel ratio, so charts are crisp and never stretched.
// Returns { ctx, W, H } in CSS pixels.
function qflowFitCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 300));
  const H = Math.max(1, Math.round(cssHeight || canvas.clientHeight || 160));
  canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

// Small inline SVG line sample matching series i (for legends).
function qflowSwatch(i) {
  const n = QFLOW_SERIES.length;
  const s = QFLOW_SERIES[((i % n) + n) % n];
  return '<svg class="qf-swatch" viewBox="0 0 28 8" aria-hidden="true" style="color:var(' + s.shade + ')">' +
    '<line x1="1" y1="4" x2="27" y2="4" stroke-width="' + s.width + '" stroke-linecap="round"' +
    (s.dash.length ? ' stroke-dasharray="' + s.dash.join(' ') + '"' : '') + '/></svg>';
}

function qflowInitChrome() {
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'appearancePanel');
    b.onclick = (e) => { e.stopPropagation(); qflowToggleAppearance(b); qflowAudio.playClick(); };
  });
  _qflowPaintThemeToggles();

  const soundBtns = document.querySelectorAll('.sound-toggle');
  const paintSound = (state) => soundBtns.forEach((btn) => {
    btn.textContent = state ? '🔊' : '🔇';
    btn.setAttribute('aria-label', state ? 'Mute sound effects' : 'Turn on sound effects');
  });
  soundBtns.forEach((b) => {
    paintSound(qflowAudio.enabled);
    b.onclick = () => {
      const state = qflowAudio.toggle();
      paintSound(state);
      qflowToast(state ? 'Sound Effects Enabled' : 'Sound Effects Muted', 'info');
    };
  });

  const burger = document.getElementById('hamburger'),
    nav = document.getElementById('nav');
  if (burger && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
      burger.textContent = open ? '✕' : '☰';
    };
    burger.onclick = (e) => {
      e.stopPropagation();
      setOpen(!nav.classList.contains('open'));
      qflowAudio.playClick();
    };
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        burger.focus();
      }
    });
    nav.querySelectorAll('.links a').forEach((a) => {
      a.addEventListener('click', () => setOpen(false));
    });
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        qflowFitNav();
        if (getComputedStyle(burger).display === 'none') setOpen(false);
      }, 120);
    });
  }
  qflowApplyLang();
  qflowFitNav();
}

// Collapse the nav into the menu at wide widths too when its items do not fit
// (e.g. longer labels in some languages, or Judge mode's extra links).
// Below 1181px the CSS already collapses it.
function qflowFitNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.classList.remove('nav--collapsed');
  if (window.innerWidth <= 1180) return;
  const menu = nav.querySelector('.nav-menu');
  const overflow = nav.scrollWidth > nav.clientWidth + 1 || (menu && menu.scrollWidth > menu.clientWidth + 1);
  nav.classList.toggle('nav--collapsed', !!overflow);
}

