/* =========================================================
   Q-FLOW — MAP: Leaflet map builder, layer switcher and controls
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: Leaflet (L), config.js (QFLOW_CONFIG.tiles).
   ========================================================= */

/* =========================================================
   MAP BUILDER & INTERACTIVE PIN SETTER
   ========================================================= */
// Street basemap. With a TomTom key (live traffic on): TomTom's map style, which looks
// like a phone navigation map, in day or night style to match the theme. Otherwise the
// OpenStreetMap standard style. Falls back to OpenStreetMap if TomTom tiles fail.
function qflowStreetTiles() {
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dusk';
  if (typeof qflowLive !== 'undefined' && qflowLive && qflowLive.enabled() && typeof qflowLiveKey === 'function' && qflowLiveKey()) {
    return { url: (QFLOW_CONFIG.tomtomBaseUrl || 'https://api.tomtom.com') + '/map/1/tile/basic/' + (dark ? 'night' : 'main') + '/{z}/{x}/{y}.png?key=' + encodeURIComponent(qflowLiveKey()) + '&tileSize=256',
      attribution: '© TomTom', className: 'qf-tiles-native', provider: 'tomtom' };
  }
  return { url: QFLOW_CONFIG.tiles.streets, attribution: '© OpenStreetMap contributors', className: 'qf-tiles-map', provider: 'osm' };
}
function qflowStreetLayer() {
  let t = qflowStreetTiles();
  const layer = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: 19, className: t.className });
  let loaded = 0, errors = 0;
  if (layer.on) {
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => {
      // TomTom key without the Map Display API (or offline TomTom): use OpenStreetMap instead.
      if (t.provider === 'tomtom' && ++errors >= 6 && !loaded) {
        t = { url: QFLOW_CONFIG.tiles.streets, attribution: '© OpenStreetMap contributors', className: 'qf-tiles-map', provider: 'osm' };
        const c = layer.getContainer && layer.getContainer();
        if (c) { c.classList.remove('qf-tiles-native'); c.classList.add('qf-tiles-map'); }
        layer.options.className = 'qf-tiles-map';
        layer.setUrl(t.url);
      }
    });
  }
  if (t.provider === 'tomtom' && typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('qflow:themechange', () => { if (t.provider === 'tomtom') layer.setUrl(qflowStreetTiles().url); });
  }
  return layer;
}

function qflowBuildMap(containerId, opts = {}) {
  const fullView = qflowFullMapLayout(containerId);
  const map = L.map(containerId, {
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: true,
    // SVG (not canvas): route and marker styles come from CSS classes (qf-route-*, ...).
    preferCanvas: false
  });

  // Tiles are shown in greyscale by style.css; className lets satellite photos
  // keep their tones (no inversion) in the dark theme.
  const streets = qflowStreetLayer();
  const satellite = L.tileLayer(
    QFLOW_CONFIG.tiles.satellite,
    { attribution: '© Esri', maxZoom: 19, className: 'qf-tiles-photo' }
  );
  const terrain = L.tileLayer(QFLOW_CONFIG.tiles.terrain, {
    attribution: '© OpenTopoMap',
    maxZoom: 17,
    className: 'qf-tiles-map'
  });
  streets.addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const LayerCtl = L.control({ position: 'topright' });
  LayerCtl.onAdd = function () {
    const box = L.DomUtil.create('div', 'map-layerbox');
    box.innerHTML = `
      <button class="layer-btn active" data-l="streets">Map</button>
      <button class="layer-btn" data-l="satellite">Satellite</button>
      <button class="layer-btn" data-l="terrain">Terrain</button>`;
    L.DomEvent.disableClickPropagation(box);
    box.querySelectorAll('.layer-btn[data-l]').forEach((btn) => {
      btn.onclick = () => {
        box.querySelectorAll('.layer-btn[data-l]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        map.eachLayer((l) => {
          if (l === streets || l === satellite || l === terrain) map.removeLayer(l);
        });
        ({ streets, satellite, terrain })[btn.dataset.l].addTo(map);
      };
    });
    return box;
  };
  LayerCtl.addTo(map);

  // Live traffic (TomTom flow tiles) when a key is set: its own pane, so the greyscale tile
  // filter does not apply. map._qflowLiveTraffic becomes true only after a tile has loaded;
  // the container then fires 'qflow:livetraffic' so pages can switch their labels.
  if (typeof qflowLive !== 'undefined' && qflowLive && qflowLive.enabled()) qflowAddLiveTrafficLayer(map);

  if (opts.collapsible) {
    const MiniCtl = L.control({ position: 'topleft' });
    MiniCtl.onAdd = function () {
      const btn = L.DomUtil.create('button', 'map-mini-btn');
      btn.textContent = '⤢';
      btn.title = 'Minimize / Expand Map';
      L.DomEvent.disableClickPropagation(btn);
      const el = document.getElementById(containerId);
      btn.onclick = () => {
        el.classList.toggle('map-collapsed');
        setTimeout(() => map.invalidateSize(), 260);
      };
      return btn;
    };
    MiniCtl.addTo(map);
  }

  const LocCtl = L.control({ position: 'bottomright' });
  LocCtl.onAdd = function () {
    const btn = L.DomUtil.create('button', 'map-locate-btn');
    btn.textContent = '◎';
    btn.title = 'Center on My Location';
    L.DomEvent.disableClickPropagation(btn);
    btn.onclick = () => {
      if (map._qflowLoc) map.setView(map._qflowLoc, 15);
    };
    return btn;
  };
  LocCtl.addTo(map);

  if (fullView) qflowFitAboveSheet(map, fullView);
  return map;
}

function qflowAddLiveTrafficLayer(map) {
  const url = qflowLive.tileUrl('relative0');
  if (!url || !map.createPane) return null;
  const pane = map.createPane('qfTraffic');
  pane.classList.add('qf-traffic-pane');
  pane.style.zIndex = 350; // above base tiles (200), below routes and markers (400+)
  const layer = L.tileLayer(url, { pane: 'qfTraffic', maxZoom: 19, opacity: 0.9, attribution: 'Traffic © TomTom' });
  let loaded = 0, errors = 0;
  layer.on('tileload', () => {
    if (loaded++ === 0) {
      map._qflowLiveTraffic = true;
      const box = map.getContainer().querySelector('.map-layerbox');
      if (box) box.classList.add('has-live');
      map.getContainer().dispatchEvent(new CustomEvent('qflow:livetraffic', { bubbles: true }));
    }
  });
  layer.on('tileerror', () => {
    if (++errors === 8 && !loaded) qflowStatus.service('Live traffic tiles (TomTom) did not load. Check the API key or your connection.');
  });
  layer.addTo(map);
  map._qflowTrafficLayer = layer;

  const box = map.getContainer().querySelector('.map-layerbox');
  if (box) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-btn traffic-btn active';
    btn.textContent = 'Traffic';
    btn.setAttribute('aria-pressed', 'true');
    btn.onclick = () => {
      const on = !map.hasLayer(layer);
      if (on) layer.addTo(map); else map.removeLayer(layer);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    box.appendChild(btn);
    const key = document.createElement('div');
    key.className = 'qf-live-key';
    key.innerHTML = '<span class="qf-live-bar" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>Live · TomTom</span>';
    key.title = 'Green: free flow · yellow/orange: slower · red: jam · dark red: closed';
    box.appendChild(key);
  }
  return layer;
}

// Real incidents (traffic-live.js parseIncidents) on a map: an icon per incident, its affected
// stretch as a line, and a popup with TomTom's description. Returns the layer group.
function qflowShowIncidents(map, list) {
  if (map._qflowIncidents) map.removeLayer(map._qflowIncidents);
  const g = L.layerGroup();
  (list || []).slice(0, 60).forEach((it) => {
    const where = [it.road, it.from && it.to ? it.from + ' → ' + it.to : it.from || it.to].filter(Boolean).join(' · ');
    const html = '<b>' + escapeHtml(it.icon + ' ' + it.category) + '</b><br>' + escapeHtml(it.description || it.magnitude) +
      (where ? '<br><small>' + escapeHtml(where) + '</small>' : '') +
      (Number.isFinite(it.delayMin) && it.delayMin > 0 ? '<br>Delay: about ' + it.delayMin + ' min' : '') +
      '<br><small>Live incident · TomTom</small>';
    if (it.line.length > 1) L.polyline(it.line, { className: 'qf-incident-line', weight: 5, interactive: true }).bindPopup(html).addTo(g);
    L.marker([it.lat, it.lng], { icon: L.divIcon({ className: 'qf-incident-pin', html: escapeHtml(it.icon), iconSize: [22, 22] }), title: it.category }).bindPopup(html).addTo(g);
  });
  g.addTo(map);
  map._qflowIncidents = g;
  return g;
}

// One-line summary of an incident for lists.
function qflowIncidentLine(it) {
  const where = it.road || [it.from, it.to].filter(Boolean).join(' → ') || 'Nearby road';
  return { where, what: it.category + (Number.isFinite(it.delayMin) && it.delayMin > 0 ? ', +' + it.delayMin + ' min' : ''), level: it.magnitudeCode >= 3 || it.categoryCode === 8 ? 'r' : it.magnitudeCode === 2 ? 'y' : 'g' };
}

// Runs fn once live traffic tiles have loaded on this map (or never, without live traffic).
function qflowOnLiveTraffic(map, fn) {
  if (map._qflowLiveTraffic) return fn();
  map.getContainer().addEventListener('qflow:livetraffic', () => fn(), { once: true });
}

/* =========================================================
   FULL-SCREEN MAP LAYOUT (Google-Maps style)
   The page's map frame becomes a full-screen layer under the top bar, and every
   other block on the page moves, unchanged and in order, into a panel docked at
   the bottom (.qf-sheet). Elements are moved, not copied, so ids, handlers and
   page scripts keep working. The panel has three heights (min / half / full):
   tap the handle to switch between half and full, or drag it.
   ========================================================= */
let _qflowSheet = null;

function qflowFullMapLayout(containerId) {
  try {
    if (_qflowSheet || typeof document === 'undefined' || !document.body || typeof window.getComputedStyle !== 'function') return null;
    const box = document.getElementById(containerId);
    const frame = box && box.parentElement;
    if (!frame || !frame.classList || !frame.classList.contains('map-frame') || !box.classList.contains('map-box')) return null;
    const body = document.body, nav = document.getElementById('nav');

    const view = document.createElement('div');
    view.className = 'qf-mapview';
    const sheet = document.createElement('section');
    sheet.className = 'qf-sheet';
    sheet.dataset.state = 'half';
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'qf-sheet-handle';
    handle.setAttribute('aria-label', 'Resize the panel below the map');
    handle.setAttribute('aria-expanded', 'false');
    handle.innerHTML = '<span class="qf-sheet-grip" aria-hidden="true"></span>';
    const content = document.createElement('div');
    content.className = 'qf-sheet-body';
    sheet.append(handle, content);

    view.appendChild(frame);
    // Everything else in the page, in its original order. Scripts and fixed overlays
    // (modals, background canvas, toasts) stay where they are.
    Array.from(body.children).forEach((el) => {
      if (el === nav || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) return;
      if (window.getComputedStyle(el).position === 'fixed') return;
      content.appendChild(el);
    });
    if (nav) nav.after(view, sheet); else body.prepend(view, sheet);
    body.classList.add('qf-fullmap');

    const setState = (state) => {
      sheet.dataset.state = state;
      sheet.style.height = '';
      handle.setAttribute('aria-expanded', state === 'full' ? 'true' : 'false');
      body.classList.toggle('qf-sheet-full', state === 'full');
    };
    // Report the panel's height so map controls, the legend and fitBounds stay above it.
    const report = () => document.documentElement.style.setProperty('--qf-sheet-h', Math.round(sheet.getBoundingClientRect().height) + 'px');
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(sheet);
    else { window.addEventListener('resize', report); sheet.addEventListener('transitionend', report); }
    report();

    // Tap: half <-> full (min -> half). Drag: follow the finger, then snap to the nearest height.
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, moved: false };
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      sheet.classList.add('qf-sheet--dragging');
      const maxH = view.getBoundingClientRect().height;
      sheet.style.height = Math.max(56, Math.min(maxH, drag.h - dy)) + 'px';
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) { sheet.classList.remove('qf-sheet--dragging'); return; }
      // Measure the three snap heights with transitions still off, then animate to the nearest.
      const h = sheet.getBoundingClientRect().height;
      const heights = {};
      ['min', 'half', 'full'].forEach((st) => { sheet.style.height = ''; sheet.dataset.state = st; heights[st] = sheet.getBoundingClientRect().height; });
      const best = Object.keys(heights).reduce((a, b) => (Math.abs(heights[b] - h) < Math.abs(heights[a] - h) ? b : a));
      sheet.style.height = h + 'px';
      void sheet.offsetHeight;
      sheet.classList.remove('qf-sheet--dragging');
      setState(best);
      handle._qflowDragged = true;
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('click', () => {
      if (handle._qflowDragged) { handle._qflowDragged = false; return; }
      setState(sheet.dataset.state === 'half' ? 'full' : 'half');
    });

    // The map's own "Minimize / Expand Map" button (home page) now gives the panel the screen.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => setState(box.classList.contains('map-collapsed') ? 'full' : 'half'))
        .observe(box, { attributes: true, attributeFilter: ['class'] });
    }
    _qflowSheet = { view, sheet, setState };
    return _qflowSheet;
  } catch (e) {
    return null; // keep the normal layout if anything is unsupported
  }
}

// fitBounds keeps routes and pins above the bottom panel (it covers part of the map).
function qflowFitAboveSheet(map, fullView) {
  const orig = map.fitBounds.bind(map);
  map.fitBounds = (bounds, o = {}) => {
    const pad = o.padding ? L.point(o.padding) : L.point(0, 0);
    const mapH = map.getSize().y;
    const cover = Math.min(fullView.sheet.getBoundingClientRect().height, mapH * 0.6);
    const br = L.point(o.paddingBottomRight || pad);
    return orig(bounds, { ...o, paddingTopLeft: o.paddingTopLeft || pad, paddingBottomRight: L.point(br.x, br.y + cover) });
  };
}

