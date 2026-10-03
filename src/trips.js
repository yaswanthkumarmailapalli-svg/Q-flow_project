/* =========================================================
   Q-FLOW — TRIPS: history, leave-by time, and GPX / GeoJSON export
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: safe-html.js (escapeHtml), ui.js (qflowToast).
   ========================================================= */

/* ---------- HISTORY & UTILS ---------- */
function qflowAddHistory(place) {
  if (!place) return;
  let hist = JSON.parse(localStorage.getItem('qflowHistory') || '[]');
  hist = hist.filter((h) =>
    h.label ? h.label.toLowerCase() !== place.label.toLowerCase() : true
  );
  hist.unshift(place);
  localStorage.setItem('qflowHistory', JSON.stringify(hist.slice(0, 5)));
}
function qflowGetHistory() {
  return JSON.parse(localStorage.getItem('qflowHistory') || '[]');
}

function qflowLeaveBy(arriveHHMM, travelMinutes) {
  if (!arriveHHMM) return null;
  const [h, m] = arriveHHMM.split(':').map(Number);
  const arriveDate = new Date();
  arriveDate.setHours(h, m, 0, 0);
  const leaveDate = new Date(arriveDate.getTime() - travelMinutes * 60000);
  return leaveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function qflowTimeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  return Math.round(s/60) + 'm ago';
}

/* ---------- EXPORT FORMATS (GPX & GeoJSON) ---------- */
function qflowExportGeoJSON(route) {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          id: route.id,
          tag: route.tag,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          co2Grams: route.co2Grams,
          co2Method: 'estimate: speed-dependent g/km curve (approximate, COPERT-style)',
          generator: 'Q-FLOW Quantum-Inspired Traffic Optimizer'
        },
        geometry: route.geometry
      }
    ]
  };
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qflow_route_${route.id || 'optimized'}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
  qflowToast('GeoJSON Route Exported', 'success');
}

function qflowExportGPX(route) {
  const coords = route.geometry.coordinates;
  const trkpts = coords.map((c) => `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`).join('\n      ');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Q-FLOW SIH26137">
  <trk>
    <name>Q-FLOW Route ${escapeHtml(route.id || 'A')}</name>
    <desc>${escapeHtml(route.tag || 'Q-FLOW Optimized Route')}</desc>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qflow_route_${route.id || 'A'}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
  qflowToast('GPX Navigation File Exported', 'success');
}
