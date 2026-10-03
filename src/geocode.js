/* =========================================================
   Q-FLOW — GEOCODING: reverse geocode (Nominatim) and place autocomplete (Photon)
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   Needs: config.js, ui.js (qflowAudio) at call time.
   ========================================================= */

// Coordinates are rounded to ~1 m so nearby repeats hit the cache.
// Nominatim's policy allows at most 1 request/second, enforced by minIntervalMs.
function qflowReverseGeocode(loc, cb) {
  const url = `${QFLOW_CONFIG.nominatimBaseUrl}/reverse?format=json&lat=${(+loc.lat).toFixed(5)}&lon=${(+loc.lng).toFixed(5)}&zoom=16`;
  qflowNet
    .getJSON(url, {
      service: 'nominatim',
      label: 'The address lookup (Nominatim)',
      ttlMs: QFLOW_CONFIG.cacheTtlMs.reverseGeocode,
      cacheIf: (d) => !!(d && d.display_name),
      minIntervalMs: QFLOW_CONFIG.nominatimMinIntervalMs
    })
    .then((d) =>
      cb(
        d && d.display_name
          ? d.display_name.split(',').slice(0, 2).join(',').trim()
          : 'Your Location'
      )
    )
    .catch(() => cb('Your Location'));
}

/* ---------- AUTOCOMPLETE WITH COMPREHENSIVE QUERY FILTER ---------- */
// Only one search is in flight at a time: a new search (or qflowCancelAutocomplete)
// aborts the previous one. Errors are shown in the suggestion box, not the status bar.
let _qflowACController = null;
function qflowCancelAutocomplete() {
  if (_qflowACController) _qflowACController.abort();
  _qflowACController = null;
}
function qflowAutocomplete(query, near, cb) {
  qflowCancelAutocomplete();
  const controller = (_qflowACController = new AbortController());
  let url = `${QFLOW_CONFIG.photonBaseUrl}/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`;
  if (near && near.lat && near.lng) {
    url += `&lat=${(+near.lat).toFixed(3)}&lon=${(+near.lng).toFixed(3)}&location_bias_scale=0.8`;
  }
  qflowNet
    .getJSON(url, {
      service: 'photon',
      label: 'Place search (Photon)',
      ttlMs: QFLOW_CONFIG.cacheTtlMs.autocomplete,
      cacheIf: (d) => !!(d && Array.isArray(d.features)),
      signal: controller.signal,
      silent: true
    })
    .then((d) => {
      if (controller.signal.aborted) return;
      const results = (d.features || []).map((f) => {
        const p = f.properties;
        const parts = [p.name, p.street, p.city || p.district, p.state].filter(Boolean);
        const label = [...new Set(parts)].join(', ');
        return {
          label: label || p.name || query,
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0]
        };
      });
      cb({ ok: true, results });
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      cb({ ok: false, results: [], error: err });
    });
}

function qflowAttachAutocomplete(input, opts) {
  opts = opts || {};
  const minChars = opts.minChars || 2;
  const box = document.createElement('div');
  box.className = 'ac-box';
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(box);
  let timer = null;

  function hide() {
    box.style.display = 'none';
    box.replaceChildren();
  }
  function showMsg(msg) {
    const el = document.createElement('div');
    el.className = 'ac-msg';
    el.textContent = msg;
    box.replaceChildren(el);
    box.style.display = 'block';
  }
  function showResults(results) {
    if (!results.length) {
      showMsg('No exact matches — try a landmark, street, or city.');
      return;
    }
    // Geocoder labels are external data: build rows with textContent, not HTML.
    box.replaceChildren(
      ...results.map((r) => {
        const el = document.createElement('div');
        el.className = 'ac-item';
        const pin = document.createElement('span');
        pin.textContent = '📍';
        const label = document.createElement('span');
        label.textContent = r.label;
        el.append(pin, ' ', label);
        el.onclick = () => {
          input.value = r.label;
          hide();
          qflowAudio.playClick();
          opts.onSelect && opts.onSelect(r);
        };
        return el;
      })
    );
    box.style.display = 'block';
  }

  // Debounced (QFLOW_CONFIG.autocompleteDebounceMs, ~300 ms); every keystroke
  // also cancels the request already in flight so stale results never render.
  input.addEventListener('input', () => {
    clearTimeout(timer);
    qflowCancelAutocomplete();
    const q = input.value.trim();
    if (q.length < minChars) {
      hide();
      return;
    }
    showMsg('Searching nearby places…');
    timer = setTimeout(() => {
      const near = opts.getNear ? opts.getNear() : null;
      qflowAutocomplete(q, near, (res) => {
        if (input.value.trim() !== q) return; // user kept typing
        if (!res.ok) {
          showMsg('⚠ ' + (res.error && res.error.userMessage ? res.error.userMessage : 'Search temporarily unavailable.') + ' You can also tap the map to pick a point.');
          return;
        }
        showResults(res.results);
      });
    }, QFLOW_CONFIG.autocompleteDebounceMs);
  });
  input.addEventListener('blur', () => setTimeout(hide, 180));
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= minChars && box.hasChildNodes()) box.style.display = 'block';
  });
}

