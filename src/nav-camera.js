/* =========================================================
   Q-FLOW — NAVIGATION: NavigationCameraController
   UMD: browser global QFlowNavCamera, or require() in Node tests (math helpers).

   Leaflet has no map rotation, so the map lives in a square "rotor" element (side = the
   viewport diagonal, so no corners show) that is rotated with CSS. Leaflet's own drag/zoom
   handlers are off; this controller handles gestures in screen space and converts them to
   map space, so panning, pinch-zoom and two-finger rotation work at any rotation.

   Modes:
     follow - keeps the user's real position on screen (lower third in heading-up), rotates
              the map to the direction of travel, picks the zoom from speed, and moves
              smoothly (rate-limited rotation, eased centre) instead of snapping.
     free   - entered by any user gesture; the camera stops following until recenter().
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFlowNavCamera = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const rad = (d) => (d * Math.PI) / 180;
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const angleDiff = (a, b) => ((b - a + 540) % 360) - 180;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Screen-space vector -> map-pixel vector when the map is rotated by `bearing`
  // (the rotor has CSS rotate(-bearing)).
  function screenToMap(dx, dy, bearing) {
    const b = rad(bearing), c = Math.cos(b), s = Math.sin(b);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  // Point `dist` pixels ahead of p in direction `bearing` (map pixel space, y down, north up).
  function aheadPx(p, bearing, dist) {
    return { x: p.x + dist * Math.sin(rad(bearing)), y: p.y - dist * Math.cos(rad(bearing)) };
  }
  // Zoom from speed (m/s): slower = closer. Hysteresis is applied by the controller.
  function zoomForSpeed(v) {
    if (!(v >= 0)) return 17;
    return v < 8 ? 17 : v < 17 ? 16 : v < 25 ? 15.5 : 15;
  }
  // Rotate from `cur` toward `target`: eased, at most maxRate deg/s, dead band 0.3 deg.
  function stepBearing(cur, target, dtS, maxRate) {
    const d = angleDiff(cur, target);
    if (Math.abs(d) < 0.3) return target;
    const eased = d * Math.min(1, dtS * 4);
    const lim = (maxRate || 90) * dtS;
    return norm360(cur + clamp(eased, -lim, lim));
  }

  function createNavigationCamera(o) {
    const L = o.L, map = o.map, viewport = o.viewport, rotor = o.rotor;
    const raf = o.requestAnimationFrame || ((f) => setTimeout(() => f(Date.now()), 16));
    const nowMs = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    let mode = 'follow', headingUp = o.headingUp !== false;
    let rot = 0, user = null, travelBearing = null, targetZoom = 17, zoomSince = 0, animating = false, last = 0;

    function size() {
      const w = viewport.clientWidth, h = viewport.clientHeight, d = Math.ceil(Math.hypot(w, h));
      rotor.style.width = d + 'px'; rotor.style.height = d + 'px';
      rotor.style.left = Math.round((w - d) / 2) + 'px'; rotor.style.top = Math.round((h - d) / 2) + 'px';
      map.invalidateSize({ pan: false, animate: false });
    }
    function applyRotation() { rotor.style.transform = 'rotate(' + (-rot).toFixed(2) + 'deg)'; if (o.onRotate) o.onRotate(rot); }
    function setMode(m) { if (m === mode) return; mode = m; if (o.onModeChange) o.onModeChange(mode); }

    function targetBearing() { return headingUp && travelBearing !== null ? travelBearing : 0; }
    function desiredCenter(z) {
      const p = map.project(L.latLng(user.lat, user.lng), z);
      // Heading-up: user in the lower part of the screen so the road ahead is visible.
      const off = headingUp && travelBearing !== null ? viewport.clientHeight * 0.22 : 0;
      return map.unproject(L.point(aheadPx(p, rot, off)), z);
    }

    function frame() {
      const t = nowMs(), dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016;
      last = t;
      let moving = false;
      if (mode === 'follow' && user) {
        const tb = targetBearing();
        const nb = stepBearing(rot, tb, dt, 90);
        if (nb !== rot) { rot = nb; applyRotation(); moving = moving || nb !== tb; }
        if (map._animatingZoom) moving = true; // let Leaflet's zoom animation finish first
        else {
          const z = map.getZoom();
          // Zoom changes are single animated steps (setZoom with animation does not rebuild
          // the tiles; setView/setZoom with animate:false would, and the map would flicker).
          if (Math.abs(targetZoom - z) > 0.05) { map.setZoom(targetZoom); moving = true; }
          else {
            const cp = map.project(map.getCenter(), z), wp = map.project(desiredCenter(z), z);
            const dist = Math.hypot(wp.x - cp.x, wp.y - cp.y);
            if (dist > 0.5) {
              // Ease towards the target with a pan (no view reset); big gaps close at once.
              const k = dist > 400 ? 1 : Math.min(1, dt * 5);
              map.panBy(L.point((wp.x - cp.x) * k, (wp.y - cp.y) * k), { animate: false });
              moving = moving || dist * (1 - k) > 0.5;
            }
          }
        }
      }
      if (moving) raf(frame); else { animating = false; last = 0; }
    }
    function kick() { if (!animating) { animating = true; last = 0; raf(frame); } }

    // ---------- gestures (screen space -> map space) ----------
    const pts = new Map();
    let g = null;
    function startGesture() {
      const p = [...pts.values()];
      if (p.length === 1) g = { kind: 'pan', x: p[0].x, y: p[0].y };
      else if (p.length >= 2) g = { kind: 'pinch', d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), zoom: map.getZoom(), rot };
    }
    function onDown(e) {
      if (e.target && e.target.closest && e.target.closest('button, a, .nav-hud, .nav-controls')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (viewport.setPointerCapture) try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      setMode('free');
      startGesture();
    }
    function onMove(e) {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = [...pts.values()];
      if (g.kind === 'pan' && p.length === 1) {
        const v = screenToMap(p[0].x - g.x, p[0].y - g.y, rot);
        map.panBy(L.point(-v.x, -v.y), { animate: false });
        g.x = p[0].x; g.y = p[0].y;
      } else if (p.length >= 2) {
        if (g.kind !== 'pinch') startGesture();
        const d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
        if (g.d > 10) pinchZoom(clamp(g.zoom + Math.log2(d / g.d), 3, 19));
        const turn = (a - g.a) * 180 / Math.PI;
        if (Math.abs(turn) > 4 || g.rotating) { g.rotating = true; rot = norm360(g.rot - turn); applyRotation(); }
      }
    }
    // Pinch zoom the way Leaflet's own TouchZoom does: _move with { pinch } scales the
    // existing tiles; _moveEnd at the end loads the new ones. Falls back to setZoom.
    let pinched = false;
    function pinchZoom(z) {
      if (typeof map._move === 'function') { if (map._stop) map._stop(); map._move(map.getCenter(), z, { pinch: true, round: false }); pinched = true; }
      else map.setZoom(z);
    }
    function onUp(e) {
      pts.delete(e.pointerId);
      if (pts.size) startGesture();
      else { g = null; if (pinched && typeof map._moveEnd === 'function') map._moveEnd(true); pinched = false; }
    }
    function onWheel(e) { e.preventDefault(); setMode('free'); map.setZoom(clamp(map.getZoom() - Math.sign(e.deltaY) * 0.5, 3, 19)); }
    function onDbl(e) { if (e.target && e.target.closest && e.target.closest('button')) return; setMode('free'); map.setZoom(clamp(map.getZoom() + 1, 3, 19)); }

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('dblclick', onDbl);
    if (typeof window !== 'undefined') window.addEventListener('resize', () => { size(); kick(); });
    size();

    return {
      screenToMap, aheadPx,
      get mode() { return mode; },
      get rotation() { return rot; },
      get headingUp() { return headingUp; },
      // New real position: lat/lng, smoothed travel bearing (deg or null), speed (m/s).
      update(pos, bearingDeg, speed) {
        user = { lat: pos.lat, lng: pos.lng };
        travelBearing = typeof bearingDeg === 'number' && Number.isFinite(bearingDeg) ? bearingDeg : travelBearing;
        // Zoom changes only after the speed band has been stable for 4 s (no zoom pumping).
        const z = zoomForSpeed(speed), t = nowMs();
        if (z !== targetZoom) { if (!zoomSince) zoomSince = t; else if (t - zoomSince > 4000) { targetZoom = z; zoomSince = 0; } } else zoomSince = 0;
        if (mode === 'follow') kick();
      },
      // Back to follow mode: centre on the real position, re-orient, keep following.
      recenter() { if (mode === 'follow') return; setMode('follow'); kick(); },
      toggleOrientation() {
        headingUp = !headingUp;
        if (!headingUp && mode === 'free') { rot = 0; applyRotation(); }
        kick();
        return headingUp;
      },
      northUp() { rot = 0; applyRotation(); if (mode === 'follow') kick(); },
      zoomBy(dz) { setMode('free'); map.setZoom(clamp(map.getZoom() + dz, 3, 19)); },
      // Forget the previous trip's position and heading (a new Start begins clean).
      reset() { user = null; travelBearing = null; rot = 0; applyRotation(); targetZoom = 17; zoomSince = 0; setMode('follow'); },
      // Show a whole route (preview) in free mode, north-up.
      showBounds(bounds) { setMode('free'); rot = 0; applyRotation(); map.fitBounds(bounds, { padding: [40, 40], animate: false }); },
      resize() { size(); kick(); },
      setFollow() { setMode('follow'); kick(); }
    };
  }

  return { createNavigationCamera, screenToMap, aheadPx, zoomForSpeed, stepBearing };
});
