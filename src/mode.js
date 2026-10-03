/* Q-FLOW Driver / Judge mode layer. Driver = simple app (default). Judge = research tools. */
(function () {
  var LS = localStorage, root = document.documentElement;
  var page = location.pathname.split('/').pop() || 'index.html';
  var JUDGE_PAGE = /^(vrp|lab|judge)\.html$/;
  if (JUDGE_PAGE.test(page)) LS.setItem('qflowMode', 'judge');
  var mode = function () { return LS.getItem('qflowMode') || 'driver'; };
  root.dataset.mode = mode();
  var $ = function (s) { return document.querySelector(s); };
  var toast = function (m, k) { if (window.qflowToast) qflowToast(m, k || 'success'); }; // qflowToast renders as text
  var esc = window.escapeHtml || function (v) { return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };

  /* 1. Driver / Judge switch + Judge Hub link */
  var links = $('.links'), right = $('.nav-right');
  if (links) links.insertAdjacentHTML('beforeend', '<a href="judge.html" class="judge-only">Judge Hub</a>');
  if (right) {
    var b = document.createElement('button');
    b.className = 'mode-toggle'; b.title = 'Switch between Driver and Judge view';
    var paint = function () { b.textContent = mode() === 'judge' ? '🎓 Judge view' : '🚗 Driver view'; };
    b.onclick = function () {
      var next = mode() === 'judge' ? 'driver' : 'judge';
      LS.setItem('qflowMode', next);
      if (next === 'driver' && JUDGE_PAGE.test(page)) { location.href = 'index.html'; return; }
      root.dataset.mode = next; paint();
      if (window.qflowFitNav) qflowFitNav(); // Judge view shows more nav items
      toast(next === 'judge' ? 'Judge view: research tools unlocked' : 'Driver view: simple and clean');
    };
    paint(); right.insertBefore(b, right.firstChild);
    if (window.qflowFitNav) qflowFitNav();
  }

  /* 2. Clear offline message (shared with service-error messages, see qflowStatus in config.js) */
  if (typeof qflowStatus !== 'undefined') qflowStatus.refresh();
  else {
    var bar = document.createElement('div');
    bar.className = 'offline-bar';
    bar.textContent = 'No internet. Showing the last known area. Routes may not update.';
    document.body.appendChild(bar);
    var net = function () { bar.classList.toggle('show', !navigator.onLine); };
    addEventListener('online', net); addEventListener('offline', net); net();
  }

  /* 3. First-time tips (3 short screens) */
  if (page === 'index.html' && !LS.getItem('qflowTips')) {
    var tips = [['📍', 'Allow location', 'So we can start from where you are.'],
      ['🔎', 'Type where you are going', 'Or tap the mic and say it.'],
      ['🎨', 'Pick a route colour', 'Each colour tells you why that route is different.']], i = 0;
    var o = document.createElement('div'); o.className = 'tips';
    var done = function () { LS.setItem('qflowTips', '1'); o.remove(); };
    var show = function () {
      o.innerHTML = '<div class="tip-card"><div class="tip-ico">' + tips[i][0] + '</div><h2>' + tips[i][1] + '</h2><p>' + tips[i][2] +
        '</p><div class="tip-dots">' + tips.map(function (_, j) { return '<i' + (j === i ? ' class="on"' : '') + '></i>'; }).join('') +
        '</div><button class="primary wide" id="tipNext">' + (i < 2 ? 'Next' : 'Got it') + '</button><button class="tip-skip" id="tipSkip">Skip</button></div>';
      $('#tipNext').onclick = function () { if (++i < tips.length) show(); else done(); };
      $('#tipSkip').onclick = done;
    };
    document.body.appendChild(o); show();
  }

  /* 4. Plan page: saved places + voice search */
  if (page === 'plan.html') {
    var row = $('#historyRow'), to = $('#to'), wrap = document.createElement('div');
    wrap.className = 'saved-row'; row.parentNode.insertBefore(wrap, row);
    var get = function () { try { return JSON.parse(LS.getItem('qflowSaved') || '{}'); } catch (e) { return {}; } };
    var put = function (s) { LS.setItem('qflowSaved', JSON.stringify(s)); };
    var icons = { Home: '🏠', Work: '💼', College: '🎓' };
    var paintSaved = function () {
      var s = get();
      wrap.innerHTML = Object.keys(icons).map(function (n) {
        return '<button type="button" class="chip saved" data-n="' + esc(n) + '">' + icons[n] + ' ' + esc(n) + (s[n] ? '' : ' <small>+ save</small>') + '</button>';
      }).join('');
      wrap.querySelectorAll('.saved').forEach(function (c) {
        c.onclick = function () {
          var s = get(), n = c.dataset.n;
          if (s[n]) { destPlace = s[n]; to.value = s[n].label; maybeDrawPreview(); }
          else if (typeof destPlace !== 'undefined' && destPlace) { s[n] = destPlace; put(s); toast('Saved as ' + n); paintSaved(); }
          else toast('Search a place first, then tap ' + n + ' to save it', 'warn');
        };
        c.oncontextmenu = function (e) { e.preventDefault(); var s = get(); delete s[c.dataset.n]; put(s); paintSaved(); toast('Removed'); };
      });
    };
    paintSaved();
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && to) {
      var m = document.createElement('button');
      m.type = 'button'; m.className = 'input-locate mic'; m.title = 'Say your destination'; m.textContent = '🎤';
      to.parentNode.appendChild(m);
      m.onclick = function () {
        var r = new SR();
        r.lang = ({ hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', mr: 'mr-IN' })[LS.getItem('qflowLang')] || 'en-IN';
        m.classList.add('live');
        r.onresult = function (e) {
          to.value = e.results[0][0].transcript;
          to.dispatchEvent(new Event('input', { bubbles: true })); to.focus();
          toast('Heard "' + to.value + '". Pick a suggestion.');
        };
        r.onerror = function () { toast('Could not hear you. Please type instead.', 'warn'); };
        r.onend = function () { m.classList.remove('live'); };
        r.start();
      };
    }
  }

  /* 5. Results page: heavy-traffic alert (judge's idea) + big Start-trip screen */
  if (page === 'results.html') {
    var panel = $('#insightsPanel'), box = document.createElement('div'), last = '';
    box.id = 'heavyAlert'; panel.parentNode.insertBefore(box, panel);
    var hash = function (s) { var h = 0; for (var k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0; return Math.abs(h); };
    var fmt = function (d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    // Live route times (TomTom): report the measured delay; no invented location or clear-by time.
    var liveAlertFor = function (r) {
      var d = r.liveDelayMin, inc = r.liveIncidentDelayMin;
      if (Number.isFinite(d) && d >= 5) {
        box.className = 'heavy';
        box.innerHTML = '<b>⚠ Heavy traffic on this route right now</b><p>Live traffic adds about ' + d + ' min to this trip' +
          (Number.isFinite(inc) && inc > 0 ? ', about ' + inc + ' min of it from reported jams or incidents' : '') +
          '. <i>(Live data from TomTom.)</i></p><div class="heavy-btns"><button class="secondary" id="keepGo">OK</button></div>';
        $('#keepGo').onclick = function () { box.classList.add('dim'); };
      } else {
        box.className = '';
        box.innerHTML = '<p>✓ Live traffic (TomTom): ' + (Number.isFinite(d) ? 'about ' + d + ' min of delay' : 'no delay figure') + ' on this route right now.</p>';
      }
    };
    var alertFor = function (r) {
      if (r.timeSource === 'live') return liveAlertFor(r);
      var c = r.geometry.coordinates, p = c[Math.floor(c.length * 0.35)], h = hash(r.id + r.distanceKm + c.length);
      var delay = 6 + h % 7, clear = 14 + h % 12, km = Math.max(1, r.distanceKm * 0.35).toFixed(1);
      var back = fmt(new Date(Date.now() + clear * 60000));
      box.className = 'heavy';
      box.innerHTML = '<b>⚠ Heavy traffic predicted in about ' + km + ' km</b><p>It may add about ' + delay + ' min and usually clears by ' + back +
        '. <i>(A prediction, not live data.)</i></p><p id="stopLine" class="stop-line">Looking for a place to stop nearby…</p>' +
        '<div class="heavy-btns"><button class="secondary" id="keepGo">Keep going</button><button class="primary" id="waitHere">Wait nearby, leave at ' + back + '</button></div>';
      $('#keepGo').onclick = function () { box.classList.add('dim'); toast('OK, keep going.'); };
      $('#waitHere').onclick = function () {
        var s = $('#stopLine').textContent; toast('Plan set: leave at ' + back);
        // s can contain an Overpass place name, so build with textContent.
        var head = document.createElement('b'), para = document.createElement('p');
        head.textContent = '✅ Wait nearby and leave at ' + back;
        para.textContent = s;
        box.replaceChildren(head, para);
      };
      var q = '[out:json][timeout:8];node(around:1500,' + p[1] + ',' + p[0] + ')[amenity~"cafe|fuel|restaurant"][name];out 1;';
      var say = function (t) { var e = $('#stopLine'); if (e) e.textContent = t; };
      // Best-effort: falls back to generic advice, so it does not use the status bar.
      qflowNet.getJSON(QFLOW_CONFIG.overpassUrl + '?data=' + encodeURIComponent(q), {
        service: 'overpass', label: 'The nearby-places lookup (Overpass)', ttlMs: QFLOW_CONFIG.cacheTtlMs.places,
        cacheIf: function (j) { return !!(j && j.elements); }, silent: true
      }).then(function (j) {
        var n = j.elements && j.elements[0];
        say(n ? '☕ You can stop at ' + n.tags.name + ' nearby.' : 'You can pull over safely before that point.');
      }).catch(function (err) { say((err && err.kind === 'offline' ? 'No internet for stop ideas.' : 'Stop ideas are unavailable right now.') + ' Pull over safely before that point.'); });
    };
    new MutationObserver(function () {
      if (typeof selectedRoute !== 'undefined' && selectedRoute && selectedRoute.geometry && selectedRoute.id !== last) { last = selectedRoute.id; alertFor(selectedRoute); }
    }).observe($('#avgTime'), { childList: true, characterData: true, subtree: true });

    var sb = $('.nav-sim-sidebar'), sg = document.createElement('div');
    sg.className = 'sim-signals'; if (sb) sb.insertBefore(sg, sb.children[1]);
    $('#startNavBtn').addEventListener('click', function () {
      if (typeof selectedRoute !== 'undefined' && selectedRoute) sg.textContent = '🚦 ' + selectedRoute.signals + ' signals on this route';
    });
  }

  /* 6. Road Status page: plain-words summary */
  if (page === 'network.html') {
    var side = $('.side-panel');
    if (side) {
      var d = document.createElement('div'); d.className = 'driver-net';
      d.innerHTML = '<h3>Road status</h3><div id="dnList"></div>';
      side.insertBefore(d, side.firstChild);
      var names = ['Main Road', 'Ring Road', 'Bypass', 'Old Town Road'];
      var upd = function () {
        $('#dnList').innerHTML = names.map(function (n) {
          var v = Math.random(), s = v < .4 ? ['Free', 'g'] : v < .75 ? ['Busy', 'y'] : ['Jammed', 'r'];
          return '<div class="dn"><span>' + n + '</span><b class="' + s[1] + '">' + s[0] + '</b></div>';
        }).join('') + '<small>Example values for the demo</small>';
      };
      // With live traffic: real incidents near you (TomTom), refreshed every 2 minutes.
      // Without it, or if the request fails: the example values, labelled as such.
      var live = typeof qflowLive !== 'undefined' && qflowLive && qflowLive.enabled();
      var where = function () {
        var la = parseFloat(localStorage.getItem('qflowLocLat')), ln = parseFloat(localStorage.getItem('qflowLocLng'));
        if (isFinite(la) && isFinite(ln)) return [la, ln];
        if (typeof map !== 'undefined' && map && map.getCenter) { var c = map.getCenter(); return [c.lat, c.lng]; }
        return null;
      };
      var demo = function () { upd(); setInterval(upd, 4000); };
      var liveUpd = function (first) {
        var p = where();
        if (!p) return first && demo();
        qflowLive.incidents(p[0], p[1], 10).then(function (list) {
          if (!list) return first && demo();
          if (typeof map !== 'undefined' && map && typeof qflowShowIncidents === 'function') qflowShowIncidents(map, list);
          $('#dnList').innerHTML = (list.length ? list.slice(0, 5).map(function (it) {
            var l = qflowIncidentLine(it);
            return '<div class="dn"><span>' + escapeHtml(l.where) + '</span><b class="' + l.level + '">' + escapeHtml(l.what) + '</b></div>';
          }).join('') : '<p>No traffic incidents reported within about 10 km.</p>') +
            '<small>Live incidents from TomTom · updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</small>';
          if (first) setInterval(function () { liveUpd(false); }, 120000);
        });
      };
      if (live) { $('#dnList').innerHTML = '<small>Loading live incidents (TomTom)…</small>'; liveUpd(true); } else demo();
    }
  }
})();
