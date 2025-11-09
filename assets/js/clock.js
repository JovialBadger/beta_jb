---
---
// ==UserScript==
// @name        JB_Script_Clock
// @description JS Clock (single-function, vanilla JS)
// @version     0.1
// @namespace   Jovial-Badger_Scripts
// @match       *://*/*
// @grant       none
// @author      Jovial Badger
// @downloadURL {{ site.url }}{{page.url}}
// @updateURL   {{ site.url }}{{page.url}}
// @homepageURL {{ site.url }}
// @icon        {{ site.url }}{{ "/assets/logo/letters_logo.svg" | relative_url }}
// @run-at      document-end
// ==/UserScript==
/*
  AnalogClockApp(containerId, clocksConfig)
  - Single-file, zero-dependency module that injects CSS, DOM and logic.
  - Supports multiple clocks (analog + digital), SVG-first rendering, scalable,
    per-clock settings, shapes (round, square, oval, custom path), timezone offsets,
    custom digital formats (tokens below), a user-editable settings modal,
    and persistence via localStorage.

  Digital format tokens:
    d, dd        -> day (1, 01)
    ddd, dddd    -> short/long weekday (Mon, Monday)
    m, mm        -> month number
    mmm, mmmm    -> short/long month
    yy, yyyy     -> year
    H, HH        -> 24h
    h, hh        -> 12h
    M, MM        -> minutes
    s, ss        -> seconds
    A, a         -> AM/PM
    wk           -> ISO week number
    doy          -> day of year
*/
function AnalogClockApp(containerId, clocksConfig = []) {
  // Namespace guard
  if (!containerId) containerId = 'body';
  var root = document.querySelector(containerId);
  if (!root) throw new Error('Container element not found: ' + containerId);

  // Defaults
  var DEFAULTS = {
    id: null,
    type: 'analog', // analog | digital
    shape: 'round', // round | square | oval | custom
    customPath: '', // for custom shape svg path (d attribute)
    timezone: 0, // offset hours from UTC (can be fractional)
    size: 75, // px - used for initial viewport scale, SVG is responsive
    brand: '',
    colors: {
      face: '#c5c5c5',
      border: '#000000',
      hour: '#000000',
      minute: '#000000',
      second: '#640000',
      text: '#000000',
      digitalBg: '#ffffff',
      digitalText: '#000000'
    },
    show: {
      date: true,
      ampm: true,
      seconds: true,
      minutes: true,
      fiveMinMarks: true,
      quarterMarks: true,
      week: false,
      doy: false
    },
    analog: {
      smooth: true // smooth second hand
    },
    digital: {
      format: 'ddd, dd mmm yyyy HH:MM:ss' // default format tokens
    }
  };

  // Utilities
  function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 9); }
  function merge(a, b) {
    var r = JSON.parse(JSON.stringify(a));
    if (!b) return r;
    Object.keys(b).forEach(function (k) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
        r[k] = merge(r[k] || {}, b[k]);
      } else r[k] = b[k];
    });
    return r;
  }

  function lsKey(id) { return 'AnalogClock_settings_' + id; }
  function saveSettings(id, settings) {
    try { localStorage.setItem(lsKey(id), JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  function loadSettings(id) {
    try { var v = localStorage.getItem(lsKey(id)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  // Inject CSS (kept scoped using .ac-app root)
  var STYLE_ID = 'ac-app-style';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = "\
.ac-app { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; }\
.ac-container { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }\
.ac-clock { box-sizing: border-box; position: relative; display:inline-block; }\
.ac-svg { display:block; width:100%; height:auto; }\
.ac-analog-face { stroke-width:0.8; stroke:var(--border); fill:var(--face); }\
.ac-tick { stroke:var(--border); stroke-linecap:round; }\
.ac-hand { stroke-linecap:round; /*transform-origin:50% 50%;*/ }\
.ac-center-dot { stroke:none; }\
.ac-brand { font-size:4px; fill:var(--text); text-anchor:middle; }\
.ac-digital { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; box-sizing:border-box; padding:8px; background:var(--digital-bg); color:var(--digital-text); border:1px solid var(--border); }\
.ac-digital .ac-time { font-weight:600; font-size:14px; }\
.ac-settings-btn { position:absolute; right:6px; top:6px; background:rgba(255,255,255,0.85); border:1px solid #888; padding:2px 6px; font-size:12px; cursor:pointer; z-index:4; }\
.ac-modal-backdrop { position:fixed; left:0; top:0; right:0; bottom:0; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; z-index:9999; }\
.ac-modal { width: min(720px, 95%); max-height:90vh; overflow:auto; background:#fff; padding:16px; border-radius:6px; box-shadow:0 8px 24px rgba(0,0,0,0.2); }\
.ac-modal h3 { margin:0 0 8px 0; font-size:18px; }\
.ac-modal .row { display:flex; gap:8px; align-items:center; margin:6px 0; }\
.ac-modal label { width:130px; }\
.ac-modal input[type='text'], .ac-modal input[type='number'], .ac-modal select, .ac-modal textarea { flex:1; padding:6px; }\
.ac-modal .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }\
.ac-small { width:120px; }\
.ac-medium { width:200px; }\
.ac-large { width:320px; }\
";
    document.head.appendChild(style);
  }

  // App DOM root
  var APP_CLASS = 'ac-app';
  var appRoot = document.createElement('div');
  appRoot.className = APP_CLASS;
  var container = document.createElement('div');
  container.className = 'ac-container';
  appRoot.appendChild(container);
  root.appendChild(appRoot);

  // Modal
  var modalBackdrop = null;
  function openModal(clockId) {
    closeModal();
    var clock = clocksMap[clockId];
    if (!clock) return;
    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'ac-modal-backdrop';
    var modal = document.createElement('div');
    modal.className = 'ac-modal';

    var s = clock.settings;
    modal.innerHTML = '\
      <h3>Clock Settings - ' + (s.brand || clockId) + '</h3>\
      <div class="row"><label>Type</label>\
        <select id="ac-type"><option value="analog">Analog</option><option value="digital">Digital</option></select></div>\
      <div class="row"><label>Brand</label><input id="ac-brand" type="text" value=""></div>\
      <div class="row"><label>Timezone (UTC offset)</label><input id="ac-tz" type="number" step="0.25" value=""></div>\
      <div class="row"><label>Size (%)</label><input id="ac-size" type="number" max=95 value=""></div>\
      <div class="row"><label>Shape</label>\
        <select id="ac-shape"><option value="round">Round</option><option value="square">Square</option><option value="oval">Oval</option><option value="custom">Custom Path</option></select></div>\
      <div class="row" id="ac-custom-path-row" style="display:none"><label>Custom path</label><textarea id="ac-custom-path" rows=3 placeholder="SVG path d attribute"></textarea></div>\
      <hr />\
      <h3>Colors</h3>\
      <div class="row"><label>Face</label><input id="ac-col-face" type="color"></div>\
      <div class="row"><label>Border / Marks</label><input id="ac-col-border" type="color"></div>\
      <div class="row"><label>Hour hand</label><input id="ac-col-hour" type="color"></div>\
      <div class="row"><label>Minute hand</label><input id="ac-col-minute" type="color"></div>\
      <div class="row"><label>Second hand</label><input id="ac-col-second" type="color"></div>\
      <div class="row"><label>Text</label><input id="ac-col-text" type="color"></div>\
      <hr />\
      <h3>Display</h3>\
      <div class="row"><label>Show Date</label><input id="ac-show-date" type="checkbox"></div>\
      <div class="row"><label>Show AM/PM</label><input id="ac-show-ampm" type="checkbox"></div>\
      <div class="row"><label>Show Seconds</label><input id="ac-show-seconds" type="checkbox"></div>\
      <div class="row"><label>Show Minutes</label><input id="ac-show-minutes" type="checkbox"></div>\
      <div class="row"><label>Five-minute marks</label><input id="ac-show-5m" type="checkbox"></div>\
      <div class="row"><label>Quarter marks</label><input id="ac-show-15m" type="checkbox"></div>\
      <div class="row"><label>Week number</label><input id="ac-show-week" type="checkbox"></div>\
      <div class="row"><label>Day of year</label><input id="ac-show-doy" type="checkbox"></div>\
      <hr />\
      <div id="ac-analog-options">\
        <h3>Analog Options</h3>\
        <div class="row"><label>Smooth seconds</label><input id="ac-smooth" type="checkbox"></div>\
      </div>\
      <div id="ac-digital-options" style="display:none">\
        <h3>Digital Format</h3>\
        <div class="row"><label>Format</label><input id="ac-dfmt" type="text" value=""></div>\
      </div>\
      <div class="actions">\
        <button id="ac-cancel">Cancel</button><button id="ac-save">Save</button>\
      </div>\
    ';

    modalBackdrop.appendChild(modal);
    document.body.appendChild(modalBackdrop);

    // populate fields
    modal.querySelector('#ac-type').value = s.type || 'analog';
    modal.querySelector('#ac-brand').value = s.brand || '';
    modal.querySelector('#ac-tz').value = s.timezone || 0;
    modal.querySelector('#ac-size').value = s.size || 250;
    modal.querySelector('#ac-shape').value = s.shape || 'round';
    modal.querySelector('#ac-custom-path').value = s.customPath || '';
    modal.querySelector('#ac-col-face').value = s.colors.face || DEFAULTS.colors.face;
    modal.querySelector('#ac-col-border').value = s.colors.border || DEFAULTS.colors.border;
    modal.querySelector('#ac-col-hour').value = s.colors.hour || DEFAULTS.colors.hour;
    modal.querySelector('#ac-col-minute').value = s.colors.minute || DEFAULTS.colors.minute;
    modal.querySelector('#ac-col-second').value = s.colors.second || DEFAULTS.colors.second;
    modal.querySelector('#ac-col-text').value = s.colors.text || DEFAULTS.colors.text;
    modal.querySelector('#ac-show-date').checked = !!s.show.date;
    modal.querySelector('#ac-show-ampm').checked = !!s.show.ampm;
    modal.querySelector('#ac-show-seconds').checked = !!s.show.seconds;
    modal.querySelector('#ac-show-minutes').checked = !!s.show.minutes;
    modal.querySelector('#ac-show-5m').checked = !!s.show.fiveMinMarks;
    modal.querySelector('#ac-show-15m').checked = !!s.show.quarterMarks;
    modal.querySelector('#ac-show-week').checked = !!s.show.week;
    modal.querySelector('#ac-show-doy').checked = !!s.show.doy;
    modal.querySelector('#ac-smooth').checked = !!s.analog.smooth;
    modal.querySelector('#ac-dfmt').value = (s.digital && s.digital.format) ? s.digital.format : DEFAULTS.digital.format;

    // show/hide panels based on type and shape
    function updateTypePanels() {
      var t = modal.querySelector('#ac-type').value;
      modal.querySelector('#ac-analog-options').style.display = (t === 'analog') ? '' : 'none';
      modal.querySelector('#ac-digital-options').style.display = (t === 'digital') ? '' : 'none';
    }
    function updateShapeRow() {
      var sh = modal.querySelector('#ac-shape').value;
      modal.querySelector('#ac-custom-path-row').style.display = (sh === 'custom') ? '' : 'none';
    }
    modal.querySelector('#ac-type').addEventListener('change', updateTypePanels);
    modal.querySelector('#ac-shape').addEventListener('change', updateShapeRow);
    updateTypePanels(); updateShapeRow();

    modal.querySelector('#ac-cancel').addEventListener('click', function () { closeModal(); });
    modal.querySelector('#ac-save').addEventListener('click', function () {
      // read fields and apply
      s.type = modal.querySelector('#ac-type').value;
      s.brand = modal.querySelector('#ac-brand').value;
      s.timezone = parseFloat(modal.querySelector('#ac-tz').value) || 0;
      s.size = Math.max(48, parseInt(modal.querySelector('#ac-size').value, 10) || 250);
      s.shape = modal.querySelector('#ac-shape').value;
      s.customPath = modal.querySelector('#ac-custom-path').value || '';
      s.colors.face = modal.querySelector('#ac-col-face').value;
      s.colors.border = modal.querySelector('#ac-col-border').value;
      s.colors.hour = modal.querySelector('#ac-col-hour').value;
      s.colors.minute = modal.querySelector('#ac-col-minute').value;
      s.colors.second = modal.querySelector('#ac-col-second').value;
      s.colors.text = modal.querySelector('#ac-col-text').value;
      s.show.date = modal.querySelector('#ac-show-date').checked;
      s.show.ampm = modal.querySelector('#ac-show-ampm').checked;
      s.show.seconds = modal.querySelector('#ac-show-seconds').checked;
      s.show.minutes = modal.querySelector('#ac-show-minutes').checked;
      s.show.fiveMinMarks = modal.querySelector('#ac-show-5m').checked;
      s.show.quarterMarks = modal.querySelector('#ac-show-15m').checked;
      s.show.week = modal.querySelector('#ac-show-week').checked;
      s.show.doy = modal.querySelector('#ac-show-doy').checked;
      s.analog.smooth = modal.querySelector('#ac-smooth').checked;
      s.digital.format = modal.querySelector('#ac-dfmt').value || DEFAULTS.digital.format;
      saveSettings(clockId, s);
      clock.applySettings();
      closeModal();
    });
  }
  function closeModal() {
    if (modalBackdrop && modalBackdrop.parentNode) modalBackdrop.parentNode.removeChild(modalBackdrop);
    modalBackdrop = null;
  }

  // Clocks map
  var clocksMap = {}; // id -> {el, svg, settings, applySettings, tick}

  // Create clocks from config
  clocksConfig = clocksConfig || [];
  clocksConfig.forEach(function (c) {
    var id = c.id || uid('clock_');
    var saved = loadSettings(id);
    var merged = merge(DEFAULTS, c);
    if (saved) merged = merge(merged, saved);
    merged.id = id;
    createClock(id, merged);
  });

  // Export a creation API on root (for adding more clocks later)
  appRoot.createClock = function (conf) {
    var id = conf.id || uid('clock_');
    var saved = loadSettings(id);
    var merged = merge(DEFAULTS, conf);
    if (saved) merged = merge(merged, saved);
    merged.id = id;
    createClock(id, merged);
    return id;
  };

  // Main update loop
  var ticker = null;
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      var now = Date.now();
      Object.keys(clocksMap).forEach(function (id) {
        var clock = clocksMap[id];
        if (clock && clock.tick) clock.tick(now);
      });
    }, 250); // 4Hz updates, adequate for smoothness; analog.smooth can use ms portion
  }
  startTicker();

  // Create one clock instance
  function createClock(id, settings) {
    var wrapper = document.createElement('div');
    wrapper.className = 'ac-clock ac-medium';
    wrapper.style.width = (settings.size || 50) + '%';
    wrapper.dataset.acId = id;

    // Build inner contents: settings button + svg or digital div
    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'ac-settings-btn';
    settingsBtn.textContent = '⚙';
    settingsBtn.title = 'Settings';
    settingsBtn.addEventListener('click', function (e) { e.stopPropagation(); openModal(id); });
    wrapper.appendChild(settingsBtn);

    var clockEl = document.createElement('div');
    clockEl.className = 'ac-clock-body';
    wrapper.appendChild(clockEl);

    container.appendChild(wrapper);

    // clock object
    var clockObj = {
      id: id,
      wrapper: wrapper,
      el: clockEl,
      settings: settings,
      applySettings: function () { applySettings(clockObj); },
      tick: function (now) { renderTick(clockObj, now); }
    };
    clocksMap[id] = clockObj;

    // initial render container
    applySettings(clockObj);
  }

  // Apply settings: build SVG / digital DOM as needed and set CSS vars
  function applySettings(clock) {
    var s = clock.settings;
    var el = clock.el;
    el.innerHTML = ''; // reset
    // set wrapper width from size
    clock.wrapper.style.width = s.size + '%';

    // CSS variables via style attribute on wrapper for scoping
    clock.wrapper.style.setProperty('--face', s.colors.face);
    clock.wrapper.style.setProperty('--border', s.colors.border);
    clock.wrapper.style.setProperty('--hour', s.colors.hour);
    clock.wrapper.style.setProperty('--minute', s.colors.minute);
    clock.wrapper.style.setProperty('--second', s.colors.second);
    clock.wrapper.style.setProperty('--text', s.colors.text);
    clock.wrapper.style.setProperty('--digital-bg', s.colors.digitalBg || '#fff');
    clock.wrapper.style.setProperty('--digital-text', s.colors.digitalText || s.colors.text);

    if (s.type === 'analog') {
      // Build responsive svg with viewBox 0 0 100 100
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.classList.add('ac-svg');

      // defs + clipPath for shape
      var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      var clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      var clipId = uid('acclip_');
      clip.setAttribute('id', clipId);
      var shapeEl;
      if (s.shape === 'round') {
        shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        shapeEl.setAttribute('cx', '50'); shapeEl.setAttribute('cy', '50'); shapeEl.setAttribute('r', '48');
      } else if (s.shape === 'square') {
        shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        shapeEl.setAttribute('x', '2'); shapeEl.setAttribute('y', '2'); shapeEl.setAttribute('width', '96'); shapeEl.setAttribute('height', '96'); shapeEl.setAttribute('rx', '4');
      } else if (s.shape === 'oval') {
        shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        shapeEl.setAttribute('cx', '50'); shapeEl.setAttribute('cy', '50'); shapeEl.setAttribute('rx', '48'); shapeEl.setAttribute('ry', '36');
      } else { // custom
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', s.customPath || 'M2,50 a48,48 0 1,0 96,0 a48,48 0 1,0 -96,0');
        shapeEl = path;
      }
      clip.appendChild(shapeEl);
      defs.appendChild(clip);
      svg.appendChild(defs);

      // face (use same shape as filled background)
      var faceBg = shapeEl.cloneNode(true);
      faceBg.classList.add('ac-analog-face');
      faceBg.setAttribute('fill', s.colors.face);
      faceBg.setAttribute('stroke', s.colors.border);
      svg.appendChild(faceBg);

      // ticks layer group clipped by shape
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('clip-path', 'url(#' + clipId + ')');
      svg.appendChild(g);

      // minute ticks (every 5 if enabled, else every minute when fiveMinMarks true)
      if (s.show.fiveMinMarks) {
        for (var i = 0; i < 60; i++) {
          var isQuarter = (i % 15 === 0);
          var isFive = (i % 5 === 0);
          var len = isQuarter ? 6 : (isFive ? 4 : 2);
          var strokeW = isQuarter ? 1.4 : (isFive ? 1 : 0.6);
          var tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          var angle = (i / 60) * Math.PI * 2;
          var rOuter = 48;
          var rInner = rOuter - len;
          var x1 = 50 + rInner * Math.sin(angle);
          var y1 = 50 - rInner * Math.cos(angle);
          var x2 = 50 + rOuter * Math.sin(angle);
          var y2 = 50 - rOuter * Math.cos(angle);
          tick.setAttribute('x1', x1); tick.setAttribute('y1', y1); tick.setAttribute('x2', x2); tick.setAttribute('y2', y2);
          tick.classList.add('ac-tick');
          tick.setAttribute('stroke', s.colors.border);
          tick.setAttribute('stroke-width', strokeW);
          if (!s.show.quarterMarks && isQuarter) tick.setAttribute('visibility', 'hidden');
          if (!isFive && !isQuarter && s.show.fiveMinMarks) tick.setAttribute('visibility', 'hidden');
          if (!s.show.fiveMinMarks) tick.setAttribute('visibility', 'hidden');
          g.appendChild(tick);
        }
      } else if (!s.show.fiveMinMarks) {
        // optionally show only quarter marks
        if (s.show.quarterMarks) {
          [0,15,30,45].forEach(function(i){
            var angle = (i / 60) * Math.PI * 2;
            var rOuter = 48;
            var rInner = rOuter - 6;
            var tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', 50 + rInner * Math.sin(angle)); tick.setAttribute('y1', 50 - rInner * Math.cos(angle));
            tick.setAttribute('x2', 50 + rOuter * Math.sin(angle)); tick.setAttribute('y2', 50 - rOuter * Math.cos(angle));
            tick.classList.add('ac-tick'); tick.setAttribute('stroke', s.colors.border); tick.setAttribute('stroke-width', 1.4);
            g.appendChild(tick);
          });
        }
      }

      // brand text
      var brand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      brand.setAttribute('x', '50'); brand.setAttribute('y', '18');
      brand.classList.add('ac-brand'); brand.setAttribute('fill', s.colors.text);
      brand.textContent = s.brand || '';
      svg.appendChild(brand);

      // hands group
      var handsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      handsGroup.setAttribute('id', uid('_hands'));
      svg.appendChild(handsGroup);

      // hour hand
      var hourHand = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hourHand.setAttribute('x1', '50'); hourHand.setAttribute('y1', '50'); hourHand.setAttribute('x2', '50'); hourHand.setAttribute('y2', '32');
      hourHand.classList.add('ac-hand'); hourHand.setAttribute('stroke', s.colors.hour); hourHand.setAttribute('stroke-width', '2.8');
      handsGroup.appendChild(hourHand);

      // minute hand
      var minHand = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      minHand.setAttribute('x1', '50'); minHand.setAttribute('y1', '50'); minHand.setAttribute('x2', '50'); minHand.setAttribute('y2', '20');
      minHand.classList.add('ac-hand'); minHand.setAttribute('stroke', s.colors.minute); minHand.setAttribute('stroke-width', '2');
      handsGroup.appendChild(minHand);

      // second hand
      var secHand = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      secHand.setAttribute('x1', '50'); secHand.setAttribute('y1', '50'); secHand.setAttribute('x2', '50'); secHand.setAttribute('y2', '12');
      secHand.classList.add('ac-hand'); secHand.setAttribute('stroke', s.colors.second); secHand.setAttribute('stroke-width', '1');
      handsGroup.appendChild(secHand);

      // center dot
      var cdot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cdot.setAttribute('cx', '50'); cdot.setAttribute('cy', '50'); cdot.setAttribute('r', '1.6');
      cdot.classList.add('ac-center-dot'); cdot.setAttribute('fill', s.colors.second);
      svg.appendChild(cdot);

      // save references
      clock.svg = svg;
      clock._hour = hourHand;
      clock._min = minHand;
      clock._sec = secHand;
      clock._brand = brand;
      clock._face = faceBg;

      el.appendChild(svg);

    } else { // digital
      var div = document.createElement('div');
      div.className = 'ac-digital';
      div.style.background = s.colors.digitalBg || '#fff';
      div.style.color = s.colors.digitalText || s.colors.text;
      div.style.borderColor = s.colors.border;
      div.style.borderWidth = '1px';
      div.style.borderStyle = 'solid';
      div.style.boxSizing = 'border-box';
      div.style.width = '100%';
      var brand = document.createElement('div'); brand.className = 'ac-brand-text'; brand.textContent = s.brand || '';
      var time = document.createElement('div'); time.className = 'ac-time'; time.textContent = '';
      var date = document.createElement('div'); date.className = 'ac-date'; date.textContent = '';
      var extras = document.createElement('div'); extras.className = 'ac-extras'; extras.style.fontSize = '12px';
      div.appendChild(brand); div.appendChild(time); div.appendChild(date); div.appendChild(extras);
      el.appendChild(div);
      clock._digital = {root: div, brand: brand, time: time, date: date, extras: extras};
    }

    // initial tick render
    clock.tick(Date.now());
  }

  // Rendering tick: compute timezone-correct Date and update hands/text
  function renderTick(clock, nowMillis) {
    var s = clock.settings;
    var tzOffsetMs = (s.timezone || 0) * 3600 * 1000;
    var t = new Date(nowMillis + tzOffsetMs);
    // compute parts
    var ms = t.getUTCMilliseconds();
    var sec = t.getUTCSeconds();
    var min = t.getUTCMinutes();
    var hr = t.getUTCHours();

    // analog: update transforms
    if (s.type === 'analog' && clock._hour) {
      // compute continuous angles using UTC values above
      var secWithFrac = sec + (ms / 1000);
      var minWithFrac = min + secWithFrac / 60;
      var hrWithFrac = (hr % 12) + minWithFrac / 60;
      var hourAngle = hrWithFrac * 30; // degrees
      var minAngle = minWithFrac * 6;
      var secAngle = secWithFrac * 6;

      clock._hour.setAttribute('transform', 'rotate(' + hourAngle + ' 50 50)');
      clock._min.setAttribute('transform', 'rotate(' + minAngle + ' 50 50)');
      if (s.show.seconds) {
        clock._sec.setAttribute('visibility', '');
        if (s.analog.smooth) {
          clock._sec.setAttribute('transform', 'rotate(' + secAngle + ' 50 50)');
        } else {
          clock._sec.setAttribute('transform', 'rotate(' + (Math.round(sec) * 6) + ' 50 50)');
        }
      } else {
        clock._sec.setAttribute('visibility', 'hidden');
      }

      // brand and face color updates
      if (clock._brand) clock._brand.textContent = s.brand || '';
      if (clock._face) { clock._face.setAttribute('fill', s.colors.face); clock._face.setAttribute('stroke', s.colors.border); }
      // center dot color based on hour/min/second visible
      // (not strictly necessary — kept simple)
    }

    // digital: update formatted text
    if (s.type === 'digital' && clock._digital) {
      var localDate = new Date(nowMillis + tzOffsetMs);
      var tokens = formatDateTokens(localDate, s);
      var fmt = (s.digital && s.digital.format) ? s.digital.format : DEFAULTS.digital.format;
      var txt = applyDigitalFormat(fmt, tokens);
      // put main time on first large line; if format has newlines, split
      var parts = txt.split('\n');
      clock._digital.brand.textContent = s.brand || '';
      clock._digital.time.textContent = parts[0] || '';
      clock._digital.date.textContent = parts[1] || '';
      var extras = [];
      if (s.show.week) extras.push('Week ' + tokens.wk);
      if (s.show.doy) extras.push('Day ' + tokens.doy);
      clock._digital.extras.textContent = extras.join(' · ');
    }
  }

  // Date tokenization helper (returns tokens for applyDigitalFormat)
  function formatDateTokens(d, s) {
    // d is a Date in local JS time; since we passed tz-adjusted ms we can use standard getters
    // Use UTC getters on the adjusted date for consistency
    var y = d.getUTCFullYear();
    var yy = ('' + y).slice(-2);
    var m = d.getUTCMonth(); // 0-11
    var mm = d.getUTCMonth() + 1;
    var D = d.getUTCDate();
    var dow = d.getUTCDay(); // 0-6
    var H = d.getUTCHours();
    var M = d.getUTCMinutes();
    var S = d.getUTCSeconds();
    var ms = d.getUTCMilliseconds();

    // week number ISO (wk)
    var isoWeek = (function (date) {
      var tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      var dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      var yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    })(d);

    // day of year
    var startOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var doy = Math.floor((d - startOfYear) / 86400000) + 1;

    var weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var weekdaysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    return {
      d: D,
      dd: pad(D, 2),
      ddd: weekdaysShort[dow],
      dddd: weekdaysLong[dow],
      m: mm,
      mm: pad(mm, 2),
      mmm: monthsShort[m],
      mmmm: monthsLong[m],
      yy: yy,
      yyyy: y,
      H: H,
      HH: pad(H, 2),
      h: ((H % 12) || 12),
      hh: pad(((H % 12) || 12), 2),
      M: M,
      MM: pad(M, 2),
      s: S,
      ss: pad(S, 2),
      A: (H < 12 ? 'AM' : 'PM'),
      a: (H < 12 ? 'am' : 'pm'),
      wk: isoWeek,
      doy: doy,
      ms: ms
    };
  }
  function pad(n, width) { n = '' + n; while (n.length < width) n = '0' + n; return n; }

  // Basic token replacement for digital format
  function applyDigitalFormat(fmt, tok) {
    // allow newline token \n to separate primary time/date lines
    var out = fmt.replace(/(dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy|HH|H|hh|h|MM|M|ss|s|A|a|wk|doy|ms)/g, function (match) {
      return (tok[match] !== undefined) ? tok[match] : match;
    });
    // normalize tokens for user convenience: allow literal 'MM' as minutes and 'mm' as month etc.
    return out;
  }

  // Public helper: compute ms since epoch adjusted by timezone offset (for tick use)
  // (We pass Date.now() + offset in renderTick; formatDateTokens uses UTC getters.)

  // Utilities for external manipulation: pause/resume, remove clock
  appRoot.pauseAll = function () { if (ticker) { clearInterval(ticker); ticker = null; } };
  appRoot.resumeAll = startTicker;
  appRoot.removeClock = function (id) {
    var c = clocksMap[id];
    if (!c) return;
    if (c.wrapper && c.wrapper.parentNode) c.wrapper.parentNode.removeChild(c.wrapper);
    delete clocksMap[id];
    try { localStorage.removeItem(lsKey(id)); } catch (e) { /* ignore */ }
  };

  // initial render loop run
  Object.keys(clocksMap).forEach(function (id) { clocksMap[id].tick(Date.now()); });

  // Return app root for external use (attached to container via DOM)
  return appRoot;

}
const urlClock = `{{ site.default_site_url }}`;
if (typeof site !== 'undefined') {
  if (!window.location.href.includes(urlClock)) {
    AnalogClockApp();
  }
}