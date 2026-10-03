/* Q-FLOW HTML escaping helper.
   Use escapeHtml() for any value that ends up inside an HTML string
   (innerHTML, insertAdjacentHTML, Leaflet bindPopup / divIcon html) and comes
   from outside the code: geocoder labels (Photon / Nominatim / ipapi),
   Overpass place names, OSRM street names, user input, voice-search text,
   saved places, localStorage, URL parameters.
   Prefer textContent / DOM construction where that is simple.
   Loaded before the app modules (config.js, ui.js, ...) on every page; also usable from Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    var api = factory();
    root.escapeHtml = api.escapeHtml;
    root.QFlowSafe = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  // Escapes text for use in HTML element content and quoted attribute values.
  // null / undefined become ''. Non-strings are converted with String().
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }

  return { escapeHtml: escapeHtml };
});
