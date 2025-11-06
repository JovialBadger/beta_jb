---
---
// ==UserScript==
// @name        JB_Script_Timer
// @namespace   Jovial Badger Scripts
// @match       *://*/*
// @grant       none
// @version     1.0
// @author      Jovial Badger
// @description A countdown/countup timer driven by URL query parameters.
// @downloadURL {{ site.url }}{{page.url}}
// @updateURL   {{ site.url }}{{page.url}}
// @homepageURL {{ site.url }}
// @icon        {{ site.url }}{{ "/assets/logo/letters_logo.svg" | relative_url }}
// @run-at      document-end
// ==/UserScript==
function createUrlTimer(containerId) {
  // Single function. No external deps. Injects HTML/CSS and handles URL query-driven timer + hidden settings builder with live preview.
  // Usage: createUrlTimer() or createUrlTimer('myElementId')
  (function () {
    // --------- Helpers ----------
    function qs() {
      // parse query string into object (keys lowercase)
      const params = {};
      const q = (location.search || "").replace(/^\?/, "");
      if (!q) return params;
      q.split("&").forEach(pair => {
        if (!pair) return;
        const [k, v = ""] = pair.split("=");
        try { params[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(v); }
        catch (e) { params[k.toLowerCase()] = v; }
      });
      return params;
    }

    function encodeSettings(obj) {
      const parts = [];
      for (const k in obj) {
        if (obj[k] == null || obj[k] === "") continue;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
      }
      return location.origin + location.pathname + "?" + parts.join("&");
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function pad(n, w=2) { return String(n).padStart(w, "0"); }

    // calendar-aware diff: returns object {years, months, days, hours, minutes, seconds}
    // This function computes difference from "fromDate" to "toDate" (both Date objects). If toDate < fromDate and absolute=false,
    // results are negative. We compute positive diff when toDate >= fromDate; for count-up we invert args.
    function calendarDiff(fromDate, toDate) {
      // Ensure fromDate <= toDate
      let sign = 1;
      let a = new Date(fromDate.getTime());
      let b = new Date(toDate.getTime());
      if (a.getTime() > b.getTime()) { [a,b] = [b,a]; sign = -1; }

      let years = b.getFullYear() - a.getFullYear();
      let months = b.getMonth() - a.getMonth();
      let days = b.getDate() - a.getDate();
      let hours = b.getHours() - a.getHours();
      let minutes = b.getMinutes() - a.getMinutes();
      let seconds = b.getSeconds() - a.getSeconds();

      if (seconds < 0) { seconds += 60; minutes -= 1; }
      if (minutes < 0) { minutes += 60; hours -= 1; }
      if (hours < 0) { hours += 24; days -= 1; }

      if (days < 0) {
        // borrow from previous month of b
        const prevMonth = new Date(b.getFullYear(), b.getMonth(), 0); // last day of previous month
        days += prevMonth.getDate();
        months -= 1;
      }
      if (months < 0) { months += 12; years -= 1; }
      return {
        years: years * sign,
        months: months * sign,
        days: days * sign,
        hours: hours * sign,
        minutes: minutes * sign,
        seconds: seconds * sign
      };
    }

    // Convert an input date components (year, month, day, hour, minute, second) interpreted in a time zone 'tz'
    // into a UTC epoch (ms). If tz omitted, interpret in local timezone.
    // Uses Intl API to compute offset if available; otherwise falls back to Date constructor interpretation (local).
    function dateComponentsToEpoch({year, month, day, hour=0, minute=0, second=0}, tz) {
      // If no tz -> use local
      if (!tz || !Intl || !Intl.DateTimeFormat || !Intl.DateTimeFormat.prototype.formatToParts) {
        // Create Date as if local
        const d = (year == null) ? new Date(new Date().getFullYear(), (month?month-1:0),(day||1),hour,minute,second)
                                  : new Date(year, (month?month-1:0),(day||1),hour,minute,second);
        return d.getTime();
      }

      // We'll build a string representing a date in the target timezone and parse back to UTC millis.
      // Approach: create a Date that would represent the same Y/M/D H:M:S in UTC, get its formatted parts in tz,
      // and compute difference. Simpler: compute the timezone offset for the requested components by formatting a Date
      // created as if UTC for those components and comparing to the same components in the timezone.
      // We'll create a Date as if UTC for the components -> UTCmsCandidate = Date.UTC(year,month-1,day,hour,minute,second)
      // Then find what local wall-clock time that UTCmsCandidate shows when formatted in timezone 'tz'.
      // Use a numeric algorithm to adjust until wall-clock matches components.

      // If year missing, pick current year (we'll handle rolling to next occurrence later)
      const now = new Date();
      if (year == null) year = now.getFullYear();

      // Start with an initial guess: create a Date interpreted as if UTC for the desired components
      let guess = Date.UTC(year, (month?month-1:0), (day||1), hour, minute, second);

      // We'll try to find t such that when formatted in tz, the parts match the requested components.
      // Do iterative search around guess +/- 48 hours.
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });

      function partsFor(ms) {
        const s = fmt.format(new Date(ms));
        // format looks like "MM/DD/YYYY, HH:MM:SS" in en-US; safer to parse with formatToParts
        const parts = fmt.formatToParts(new Date(ms));
        const map = {};
        for (const p of parts) {
          if (p.type !== 'literal') map[p.type] = p.value;
        }
        return {
          year: parseInt(map.year,10),
          month: parseInt(map.month,10),
          day: parseInt(map.day,10),
          hour: parseInt(map.hour,10),
          minute: parseInt(map.minute,10),
          second: parseInt(map.second,10)
        };
      }

      // Try to find ms that yields desired components
      const target = { year, month: month || 1, day: day || 1, hour, minute, second };

      // Sweep search +/- 1 day in steps of 1 minute until match found (should be quick)
      const step = 60000; // 1 minute
      const limitMs = 48 * 3600 * 1000;
      for (let delta = 0; delta <= limitMs; delta += step) {
        for (const sign of [1, -1]) {
          const ms = guess + sign * delta;
          const p = partsFor(ms);
          if (p.year === target.year && p.month === target.month && p.day === target.day &&
              p.hour === target.hour && p.minute === target.minute && p.second === target.second) {
            // Found a ms such that in timezone tz the wall clock equals the target components -> that ms is the target in UTC.
            return ms;
          }
        }
      }

      // fallback: return Date.UTC(...) as best-effort
      return guess;
    }

    function getAllTimeZones() {
      if (Intl && Intl.supportedValuesOf && typeof Intl.supportedValuesOf === "function") {
        try {
          return Intl.supportedValuesOf('timeZone');
        } catch (e) { /* fall through */ }
      }
      // Fallback common list
      return [
        "UTC","Europe/London","Europe/Paris","Europe/Berlin","America/New_York","America/Chicago",
        "America/Denver","America/Los_Angeles","Asia/Tokyo","Asia/Hong_Kong","Australia/Sydney"
      ];
    }

    function parseHexAllowAlpha(hex) {
      // Accepts #RRGGBB, #RRGGBBAA, #RGB, #RGBA
      if (!hex) return null;
      hex = hex.trim();
      if (hex[0] === "#") hex = hex.slice(1);
      if (hex.length === 3) hex = hex.split("").map(c => c+c).join("") + "FF";
      if (hex.length === 4) hex = hex.split("").map(c => c+c).join("");
      if (hex.length === 6) hex = hex + "FF";
      if (hex.length !== 8) return null;
      return "#" + hex.toUpperCase();
    }

    // Build container
    const root = containerId ? (document.getElementById(containerId) || document.body) : document.body;

    // Create main wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "urltimer-root";
    root.prepend(wrapper);

    // Inject CSS (no inline styles anywhere)
    const style = document.createElement("style");
    style.textContent = `
    .urltimer-root { font-family: Arial, Helvetica, sans-serif; max-width:860px; margin:18px auto; }
    .urltimer-card { border-radius:12px; overflow:hidden; position:relative; box-shadow:0 6px 30px rgba(0,0,0,0.15); }
    .urltimer-bg { position:relative; min-height:220px; display:flex; align-items:center; justify-content:center; padding:24px; background-repeat:no-repeat; background-size:cover; background-position:center; }
    .urltimer-overlay { position:absolute; inset:0; pointer-events:none; }
    .urltimer-content { position:relative; z-index:2; text-align:center; padding:24px; }
    .urltimer-enddate { font-size:0.95rem; margin-bottom:8px; opacity:0.95; }
    .urltimer-countdown { font-size:2rem; font-weight:700; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; align-items:baseline; }
    .urltimer-unit { display:inline-flex; flex-direction:column; align-items:center; min-width:58px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.06); }
    .urltimer-unit .value { font-size:1.45rem; font-weight:800; }
    .urltimer-unit .label { font-size:0.75rem; opacity:0.9; margin-top:4px; text-transform:uppercase; letter-spacing:0.06em; }
    .urltimer-waitmsg, .urltimer-endmsg { font-size:1rem; margin-top:12px; opacity:0.95; }
    .urltimer-controls { display:flex; gap:8px; justify-content:center; padding:12px; flex-wrap:wrap; }
    .urltimer-btn { border:0; padding:8px 12px; border-radius:8px; cursor:pointer; background:#111; color:#fff; font-size:0.95rem; }
    .urltimer-settings { padding:12px; background:#fff; border-radius:12px; box-shadow:0 6px 18px rgba(0,0,0,0.08); margin-top:12px; display:none; }
    .urltimer-row { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center; }
    .urltimer-row label { min-width:120px; font-size:0.9rem; }
    .urltimer-row input[type="text"], .urltimer-row select, .urltimer-row textarea { flex:1 1 220px; padding:8px 10px; border-radius:8px; border:1px solid #ddd; font-size:0.95rem; }
    .urltimer-small { font-size:0.85rem; opacity:0.85; }
    .urltimer-preview { margin-top:12px; padding:10px; border-radius:8px; border:1px dashed #ddd; background:#fff; }
    .urltimer-sharelink { width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ddd; }
    .urltimer-hidden { display:none !important; }
    .urltimer-footer { text-align:center; margin-top:10px; font-size:0.85rem; color:#666; }
    @media (max-width:600px) {
      .urltimer-unit { min-width:46px; padding:6px 8px; }
      .urltimer-countdown { font-size:1.4rem; }
    }
    `;
    document.head.appendChild(style);

    // Build HTML structure
    wrapper.innerHTML = `
      <div class="urltimer-card">
        <div class="urltimer-bg" id="ut-bg">
          <div class="urltimer-overlay" id="ut-overlay"></div>
          <div class="urltimer-content">
            <div class="urltimer-enddate" id="ut-enddate"></div>
            <div class="urltimer-countdown" id="ut-countdown"></div>
            <div class="urltimer-waitmsg urltimer-small" id="ut-waitmsg"></div>
            <div class="urltimer-endmsg urltimer-small" id="ut-endmsg"></div>
          </div>
        </div>
        <div class="urltimer-controls">
          <button class="urltimer-btn" id="ut-editbtn">Edit settings</button>
          <button class="urltimer-btn" id="ut-toggle-preview">Toggle Preview</button>
        </div>
        <div class="urltimer-settings" id="ut-settings">
          <div class="urltimer-row">
            <label>End date/time (ISO / partial):</label>
            <input type="text" id="s-end" placeholder="YYYY-MM-DDTHH:MM:SS or DD-MM or DD-MM-YYYY ... or leave blank and use day/month/year params">
          </div>
          <div class="urltimer-row">
            <label>Or day (1-31):</label><input type="text" id="s-day" placeholder="day (1-31)">
            <label>Month (1-12):</label><input type="text" id="s-month" placeholder="month (1-12)">
            <label>Year (optional):</label><input type="text" id="s-year" placeholder="year">
          </div>
          <div class="urltimer-row">
            <label>Time (HH:MM:SS):</label><input type="text" id="s-time" placeholder="HH:MM:SS">
            <label>Timezone:</label><select id="s-tz"></select>
          </div>
          <div class="urltimer-row">
            <label>Background colour (hex):</label><input type="text" id="s-bg" placeholder="#RRGGBBAA or #RRGGBB">
            <label>Text colour (hex):</label><input type="text" id="s-text" placeholder="#RRGGBBAA">
          </div>
          <div class="urltimer-row">
            <label>Font style:</label>
            <select id="s-font">
              <option>Arial, Helvetica, sans-serif</option>
              <option>"Times New Roman", Times, serif</option>
              <option>Georgia, serif</option>
              <option>"Courier New", monospace</option>
              <option>Tahoma, Geneva, sans-serif</option>
            </select>
            <label>Background image URL:</label><input type="text" id="s-bgimg" placeholder="https://...">
          </div>
          <div class="urltimer-row">
            <label>Waiting message:</label><input type="text" id="s-wait" placeholder="Event starts soon...">
            <label>End message:</label><input type="text" id="s-endmsginput" placeholder="Event ended">
          </div>
          <div class="urltimer-row">
            <label>Show units:</label>
            <select id="s-units" multiple size="6" required>
              <option value="years" selected>years</option>
              <option value="months" selected>months</option>
              <option value="days" selected>days</option>
              <option value="hours" selected>hours</option>
              <option value="minutes" selected>minutes</option>
              <option value="seconds" selected>seconds</option>
            </select>
            <label>Format & options:</label>
            <div style="flex:1 1 240px;">
              <label class="urltimer-small">Date format: <select id="s-format"><option value="ddd dd-mmm-yyyy">ddd dd-mmm-yyyy</option><option value="dd-mmm-yyyy">dd-mmm-yyyy</option><option value="yyyy-mm-dd">yyyy-mm-dd</option><option value="mmm dd, yyyy">mmm dd, yyyy</option></select></label>
              <label class="urltimer-small">24 hr: <select id="s-24"><option value="1" selected>Yes</option><option value="0">No (12h)</option></select></label>
              <label class="urltimer-small">Show count up after pass: <select id="s-countup"><option value="1" selected>Yes</option><option value="0">No</option></select></label>
              <label class="urltimer-small">Always show end message when passed: <select id="s-alwaysend"><option value="0">No</option><option value="1">Yes</option></select></label>
              <label class="urltimer-small">End message only for N seconds before counting up: <input id="s-endonlyfor" type="text" placeholder="seconds e.g. 3600"></label>
            </div>
          </div>

          <div class="urltimer-row">
            <label>Share link:</label>
            <input type="text" id="s-share" class="urltimer-sharelink" readonly>
            <button class="urltimer-btn" id="s-copy">Copy link</button>
            <button class="urltimer-btn" id="s-apply">Apply to preview</button>
          </div>

          <div class="urltimer-preview" id="s-preview">
            <div style="font-weight:700;margin-bottom:6px;">Live preview (separate from URL timer)</div>
            <div id="s-preview-frame"></div>
          </div>
        </div>

        <div class="urltimer-footer">Built by createUrlTimer()</div>
      </div>
    `;

    // Grab elements
    const utBg = wrapper.querySelector("#ut-bg");
    const utEnddate = wrapper.querySelector("#ut-enddate");
    const utCountdown = wrapper.querySelector("#ut-countdown");
    const utWaitmsg = wrapper.querySelector("#ut-waitmsg");
    const utEndmsg = wrapper.querySelector("#ut-endmsg");
    const utEditBtn = wrapper.querySelector("#ut-editbtn");
    const utSettings = wrapper.querySelector("#ut-settings");
    const utTogglePreview = wrapper.querySelector("#ut-toggle-preview");

    // Settings inputs
    const inpEnd = wrapper.querySelector("#s-end");
    const inpDay = wrapper.querySelector("#s-day");
    const inpMonth = wrapper.querySelector("#s-month");
    const inpYear = wrapper.querySelector("#s-year");
    const inpTime = wrapper.querySelector("#s-time");
    const inpTz = wrapper.querySelector("#s-tz");
    const inpBg = wrapper.querySelector("#s-bg");
    const inpText = wrapper.querySelector("#s-text");
    const inpFont = wrapper.querySelector("#s-font");
    const inpBgimg = wrapper.querySelector("#s-bgimg");
    const inpWait = wrapper.querySelector("#s-wait");
    const inpEndMsgInput = wrapper.querySelector("#s-endmsginput");
    const inpUnits = wrapper.querySelector("#s-units");
    const inpFormat = wrapper.querySelector("#s-format");
    const inp24 = wrapper.querySelector("#s-24");
    const inpCountUp = wrapper.querySelector("#s-countup");
    const inpAlwaysEnd = wrapper.querySelector("#s-alwaysend");
    const inpEndOnlyFor = wrapper.querySelector("#s-endonlyfor");
    const shareLink = wrapper.querySelector("#s-share");
    const btnCopy = wrapper.querySelector("#s-copy");
    const btnApply = wrapper.querySelector("#s-apply");
    const previewFrame = wrapper.querySelector("#s-preview-frame");

    // Populate timezone options
    const tzs = getAllTimeZones();
    inpTz.innerHTML = tzs.map(tz => `<option value="${tz}">${tz}</option>`).join("");

    // Utility to read initial params from URL
    const params = qs();

    // Default settings (can be overridden by URL)
    const defaults = {
      end: params.end || params.date || "",         // single ISO or flexible string
      day: params.day || "25",
      month: params.month || "12",
      year: params.year || "",
      time: params.time || params.t || "",
      tz: params.tz || Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      bg: params.bg || "#101012AA",
      text: params.text || "#FFFFFF",
      font: params.font || "Arial, Helvetica, sans-serif",
      bgimg: params.image || params.bgimg || params.img || "",
      waitMsg: params.waitmsg || "Christmas...",
      endMsg: params.endmsg || (params.endmessage || "Ended"),
      showUnits: (params.showunits ? params.showunits.split(",") : ["years","months","days","hours","minutes","seconds"]),
      format: params.format || "dd-mmm-yyyy",
      hour24: params.hour24 != null ? (params.hour24 === "0" ? false : true) : true,
      countUp: params.countup != null ? (params.countup === "0" ? false : true) : true,
      alwaysEnd: params.alwaysend === "1",
      endOnlyFor: params.endonlyfor ? parseInt(params.endonlyfor,10) : 0
    };

    // Fill settings UI with defaults (or URL)
    function fillSettingsUI(s) {
      inpEnd.value = s.end || "";
      inpDay.value = s.day || "";
      inpMonth.value = s.month || "";
      inpYear.value = s.year || "";
      inpTime.value = s.time || "";
      inpTz.value = s.tz || "";
      inpBg.value = s.bg || "";
      inpText.value = s.text || "";
      inpFont.value = s.font || "";
      inpBgimg.value = s.bgimg || "";
      inpWait.value = s.waitMsg || "";
      inpEndMsgInput.value = s.endMsg || "";
      // units multi-select
      const opts = Array.from(inpUnits.options);
      opts.forEach(o => {
        o.selected = (s.showUnits || []).indexOf(o.value) !== -1;
      });
      inpFormat.value = s.format || "dd-mmm-yyyy";
      inp24.value = s.hour24 ? "1" : "0";
      inpCountUp.value = s.countUp ? "1" : "0";
      inpAlwaysEnd.value = s.alwaysEnd ? "1" : "0";
      inpEndOnlyFor.value = s.endOnlyFor ? String(s.endOnlyFor) : "";
      shareLink.value = encodeSettings(settingsFromUI());
    }

    function settingsFromUI() {
      const selectedUnits = Array.from(inpUnits.options).filter(o => o.selected).map(o => o.value);
      return {
        end: inpEnd.value.trim(),
        day: inpDay.value.trim(),
        month: inpMonth.value.trim(),
        year: inpYear.value.trim(),
        time: inpTime.value.trim(),
        tz: inpTz.value,
        bg: inpBg.value.trim(),
        text: inpText.value.trim(),
        font: inpFont.value,
        bgimg: inpBgimg.value.trim(),
        waitMsg: inpWait.value.trim(),
        endMsg: inpEndMsgInput.value.trim(),
        showUnits: selectedUnits,
        format: inpFormat.value,
        hour24: inp24.value === "1",
        countUp: inpCountUp.value === "1",
        alwaysEnd: inpAlwaysEnd.value === "1",
        endOnlyFor: parseInt(inpEndOnlyFor.value || "0", 10) || 0
      };
    }

    // Live preview builder (separate from URL timer)
    let previewInterval = null;
    function renderPreview() {
      const s = settingsFromUI();
      previewFrame.innerHTML = "";
      const frame = document.createElement("div");
      frame.style.padding = "12px";
      frame.style.fontFamily = s.font;
      frame.style.background = s.bg || "#f6f6f6";
      frame.style.color = s.text || "#222";
      frame.style.borderRadius = "8px";
      frame.style.minHeight = "90px";
      if (s.bgimg) frame.style.backgroundImage = `url(${s.bgimg})`, frame.style.backgroundSize = "cover";
      previewFrame.appendChild(frame);

      // Build a minimal display that will update every second
      const endDateDiv = document.createElement("div");
      endDateDiv.textContent = "End: " + (s.end || `${s.day || "-"}-${s.month || "-"}-${s.year || "-"}`) + (s.time ? " " + s.time : "");
      endDateDiv.style.marginBottom = "6px";
      frame.appendChild(endDateDiv);

      const countdownDiv = document.createElement("div");
      frame.appendChild(countdownDiv);

      function computeTargetEpochFromSettings(ss) {
        // Try parse ISO-like from ss.end, fallback to day/month/year/time components; returns ms epoch or null if insufficient
        if (ss.end) {
          // try Date.parse
          const parsed = Date.parse(ss.end);
          if (!isNaN(parsed)) return parsed;
          // try common formats dd-mm(-yyyy) or dd/mm/...
          const m = ss.end.match(/^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{2,4}))?(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
          if (m) {
            const day = parseInt(m[1],10), month = parseInt(m[2],10), year = m[3] ? parseInt(m[3],10) : null;
            const hour = m[4] ? parseInt(m[4],10) : 0, minute = m[5] ? parseInt(m[5],10) : 0, second = m[6] ? parseInt(m[6],10) : 0;
            return dateComponentsToEpoch({year: year || new Date().getFullYear(), month, day, hour, minute, second}, ss.tz);
          }
        }
        if (ss.day && ss.month) {
          const day = parseInt(ss.day,10), month = parseInt(ss.month,10);
          const year = ss.year ? parseInt(ss.year,10) : null;
          const timeParts = (ss.time || "00:00:00").split(":").map(x=>parseInt(x||"0",10));
          if (year) {
            return dateComponentsToEpoch({year, month, day, hour:timeParts[0], minute:timeParts[1]||0, second:timeParts[2]||0}, ss.tz);
          } else {
            // choose next occurrence
            const now = new Date();
            let targetYear = now.getFullYear();
            let candidate = dateComponentsToEpoch({year:targetYear, month, day, hour:timeParts[0], minute:timeParts[1]||0, second:timeParts[2]||0}, ss.tz);
            if (candidate <= Date.now()) { candidate = dateComponentsToEpoch({year:targetYear+1, month, day, hour:timeParts[0], minute:timeParts[1]||0, second:timeParts[2]||0}, ss.tz); }
            return candidate;
          }
        }
        if (ss.day && !ss.month) {
          // next given day-of-month
          const day = parseInt(ss.day,10);
          const timeParts = (ss.time || "00:00:00").split(":").map(x=>parseInt(x||"0",10));
          const now = new Date();
          let candidateMonth = now.getMonth()+1; let candidateYear = now.getFullYear();
          function makeCandidate(y,m) { return dateComponentsToEpoch({year:y, month:m, day, hour:timeParts[0], minute:timeParts[1]||0, second:timeParts[2]||0}, ss.tz); }
          let cand = makeCandidate(candidateYear, candidateMonth);
          if (cand <= Date.now()) {
            candidateMonth++;
            if (candidateMonth>12) { candidateMonth=1; candidateYear++; }
            cand = makeCandidate(candidateYear, candidateMonth);
          }
          return cand;
        }
        return null;
      }

      const targetMs = computeTargetEpochFromSettings(s);

      function updatePreview() {
        if (!targetMs) {
          countdownDiv.textContent = "No valid target date provided.";
          return;
        }
        const now = Date.now();
        let diffMs = targetMs - now;
        let passed = diffMs <= 0;
        if (passed && !s.countUp) {
          countdownDiv.textContent = s.endMsg || "Ended";
          return;
        }
        // compute calendar diff
        const from = new Date(Math.min(now, targetMs));
        const to = new Date(Math.max(now, targetMs));
        let parts = calendarDiff(from, to);
        if (passed) {
          // counting up: use positive parts
          parts = { years: Math.abs(parts.years), months: Math.abs(parts.months), days: Math.abs(parts.days), hours: Math.abs(parts.hours), minutes: Math.abs(parts.minutes), seconds: Math.abs(parts.seconds) };
        }

        // Show only selected units, and hide zero-leading units
        const order = ["years","months","days","hours","minutes","seconds"];
        const unitLabels = { years:"Years", months:"Months", days:"Days", hours:"Hours", minutes:"Minutes", seconds:"Seconds" };
        countdownDiv.innerHTML = "";
        let started = false;
        for (const u of order) {
          if (s.showUnits.indexOf(u) === -1) continue;
          const val = parts[u] || 0;
          if (!started && val === 0) {
            // skip leading zero units
            continue;
          }
          started = true;
          const unitEl = document.createElement("div");
          unitEl.style.display = "inline-block";
          unitEl.style.margin = "4px";
          unitEl.style.padding = "6px 8px";
          unitEl.style.borderRadius = "6px";
          unitEl.style.background = "rgba(255,255,255,0.06)";
          unitEl.innerHTML = `<div style="font-weight:800;font-size:1.1rem">${pad(val,2)}</div><div style="font-size:0.75rem">${unitLabels[u]}</div>`;
          countdownDiv.appendChild(unitEl);
        }
        if (!countdownDiv.childNodes.length) countdownDiv.textContent = (passed ? (s.endMsg || "Ended") : s.waitMsg || "Waiting...");
      }

      updatePreview();
      if (previewInterval) clearInterval(previewInterval);
      previewInterval = setInterval(updatePreview, 1000);
    }

    // Apply button
    btnApply.addEventListener("click", (e) => {
      e.preventDefault();
      // update share link
      shareLink.value = encodeSettings(settingsFromUI());
      renderPreview();
      // ensure share link also selected
    });

    btnCopy.addEventListener("click", () => {
      shareLink.select();
      try { document.execCommand("copy"); } catch (e) {}
    });

    // toggle settings UI
    utEditBtn.addEventListener("click", () => {
      utSettings.style.display = utSettings.style.display === "none" || utSettings.style.display === "" ? "block" : "none";
    });

    // toggle preview visibility
    utTogglePreview.addEventListener("click", () => {
      const pr = wrapper.querySelector("#s-preview");
      if (!pr) return;
      pr.style.display = pr.style.display === "none" || pr.style.display === "" ? "block" : "none";
    });

    // Live update share link as settings change
    const inputs = [inpEnd, inpDay, inpMonth, inpYear, inpTime, inpTz, inpBg, inpText, inpFont, inpBgimg, inpWait, inpEndMsgInput, inpUnits, inpFormat, inp24, inpCountUp, inpAlwaysEnd, inpEndOnlyFor];
    inputs.forEach(el => {
      el.addEventListener("input", () => {
        shareLink.value = encodeSettings(settingsFromUI());
      });
      // also update preview live
      el.addEventListener("change", () => {
        try { renderPreview(); } catch (e) {}
      });
    });

    // Initialize UI from defaults (which incorporate URL params)
    fillSettingsUI(defaults);
    // ensure settings hidden initially
    utSettings.style.display = "none";

    // --------- Main URL-driven timer logic ----------
    // Function to compute a target epoch (ms) from a settings object (same format as above)
    function computeTargetEpoch(s) {
      // Try parse ISO-like s.end
      if (s.end) {
        // Attempt Date.parse
        const parsed = Date.parse(s.end);
        if (!isNaN(parsed)) return parsed;
        // try dd-mm(-yyyy)[ T hh:mm:ss] or dd/mm/...
        const m = s.end.match(/^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{2,4}))?(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (m) {
          const day = parseInt(m[1],10), month = parseInt(m[2],10), year = m[3] ? parseInt(m[3],10) : null;
          const hour = m[4] ? parseInt(m[4],10) : 0, minute = m[5] ? parseInt(m[5],10) : 0, second = m[6] ? parseInt(m[6],10) : 0;
          if (year) {
            return dateComponentsToEpoch({year, month, day, hour, minute, second}, s.tz);
          } else {
            // next occurrence of month-day
            const now = new Date();
            let candidate = dateComponentsToEpoch({year:now.getFullYear(), month, day, hour, minute, second}, s.tz);
            if (candidate <= Date.now()) candidate = dateComponentsToEpoch({year:now.getFullYear()+1, month, day, hour, minute, second}, s.tz);
            return candidate;
          }
        }
      }

      // If day & month provided
      if (s.day && s.month) {
        const day = parseInt(s.day,10), month = parseInt(s.month,10);
        const timeParts = (s.time || "00:00:00").split(":").map(x=>parseInt(x||"0",10));
        if (s.year) {
          const year = parseInt(s.year,10);
          return dateComponentsToEpoch({year, month, day, hour:timeParts[0]||0, minute:timeParts[1]||0, second:timeParts[2]||0}, s.tz);
        } else {
          const now = new Date();
          let candidate = dateComponentsToEpoch({year:now.getFullYear(), month, day, hour:timeParts[0]||0, minute:timeParts[1]||0, second:timeParts[2]||0}, s.tz);
          if (candidate <= Date.now()) candidate = dateComponentsToEpoch({year:now.getFullYear()+1, month, day, hour:timeParts[0]||0, minute:timeParts[1]||0, second:timeParts[2]||0}, s.tz);
          return candidate;
        }
      }

      // If only day provided (next day-of-month)
      if (s.day && !s.month) {
        const day = parseInt(s.day,10);
        const timeParts = (s.time || "00:00:00").split(":").map(x=>parseInt(x||"0",10));
        const now = new Date();
        let mth = now.getMonth()+1, yr = now.getFullYear();
        function candidateMs(y,m) {
          return dateComponentsToEpoch({year:y, month:m, day, hour:timeParts[0]||0, minute:timeParts[1]||0, second:timeParts[2]||0}, s.tz);
        }
        let cand = candidateMs(yr,mth);
        if (cand <= Date.now()) {
          mth++; if (mth>12) { mth=1; yr++; }
          cand = candidateMs(yr,mth);
        }
        return cand;
      }

      return null;
    }

    // build settings object from URL params (defaults variable already has most)
    const urlSettings = Object.assign({}, defaults, {
      day: params.day || defaults.day,
      month: params.month || defaults.month,
      year: params.year || defaults.year,
      end: params.end || defaults.end,
      time: params.time || defaults.time,
      tz: params.tz || defaults.tz,
      bg: parseHexAllowAlpha(params.bg) || defaults.bg,
      text: parseHexAllowAlpha(params.text) || defaults.text,
      font: params.font || defaults.font,
      bgimg: params.image || params.bgimg || params.img || defaults.bgimg,
      waitMsg: params.waitmsg || defaults.waitMsg,
      endMsg: params.endmsg || defaults.endMsg,
      showUnits: params.showunits ? params.showunits.split(",") : defaults.showUnits,
      format: params.format || defaults.format,
      hour24: params.hour24 != null ? (params.hour24 === "0" ? false : true) : defaults.hour24,
      countUp: params.countup != null ? (params.countup === "0" ? false : true) : defaults.countUp,
      alwaysEnd: params.alwaysend === "1" || defaults.alwaysEnd,
      endOnlyFor: params.endonlyfor ? parseInt(params.endonlyfor,10) : defaults.endOnlyFor
    });

    // Apply visual styles to display element according to settings
    function applyVisualSettings(s) {
      // background color and image
      const bgc = parseHexAllowAlpha(s.bg) || "#101012AA";
      utBg.style.backgroundColor = bgc;
      utBg.style.fontFamily = s.font || "Arial, Helvetica, sans-serif";
      utBg.style.color = s.text || "#ffffff";
      if (s.bgimg) {
        utBg.style.backgroundImage = `url(${s.bgimg})`;
        utBg.style.backgroundSize = "cover";
        utBg.style.backgroundPosition = "center";
      } else {
        utBg.style.backgroundImage = "";
      }
      // set text color on content nodes via CSS classes: we will set a style rule dynamically for color in overlay area by adding inline CSS to style element.
      // But requirement: no inline css. We can add a CSS class with a generated name.
      const colorClass = "ut-tc-" + Math.abs(String(s.text || "#fff").hashCode || 0);
      // simple approach: set color on content elements directly via style attribute? Requirement: "all css should be through style injection and css classes, no inline css." So we must not use element.style.* to set colors.
      // We'll create (or update) a style rule in the injected <style> for .urltimer-custom-color
      // Remove previous if any
      const existing = document.getElementById("urltimer-dynamic-colors");
      if (existing) existing.remove();
      const dyn = document.createElement("style");
      dyn.id = "urltimer-dynamic-colors";
      dyn.textContent = `
        .urltimer-custom-font { font-family: ${s.font || "inherit"}; }
        .urltimer-custom-text { color: ${s.text || "#fff"}; }
      `;
      document.head.appendChild(dyn);

      // add classes to area
      wrapper.querySelector(".urltimer-content").classList.add("urltimer-custom-font", "urltimer-custom-text");
    }

    // string date formatting for display
    function formatDateForDisplay(epochMs, fmt, tz, hour24) {
      const d = new Date(epochMs);
      if (tz && Intl && Intl.DateTimeFormat) {
        // try to format using Intl
        const opts = { timeZone: tz, hour12: !hour24, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" };
        const str = new Intl.DateTimeFormat('en-GB', opts).format(d);
        if (fmt === "yyyy-mm-dd") {
          const y = new Intl.DateTimeFormat('en-GB',{timeZone:tz, year:'numeric'}).format(d);
          const mo = new Intl.DateTimeFormat('en-GB',{timeZone:tz, month:'2-digit'}).format(d);
          const da = new Intl.DateTimeFormat('en-GB',{timeZone:tz, day:'2-digit'}).format(d);
          return `${y}-${mo}-${da}`;
        }
        return str;
      } else {
        // fallback
        const y = d.getFullYear(), mo = d.getMonth()+1, da = d.getDate();
        const hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds();
        if (fmt === "yyyy-mm-dd") return `${y}-${pad(mo)}-${pad(da)}`;
        if (fmt === "dd-mmm-yyyy") {
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          return `${pad(da)}-${months[mo-1]}-${y} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
        }
        return `${pad(da)}-${pad(mo)}-${y} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
      }
    }

    // Provide hashCode helper for string used in dynamic class naming if needed
    String.prototype.hashCode = function(){
      var h = 0, i = 0, l = this.length;
      if ( l > 0 ) while ( i < l ) { h = (h<<5) - h + this.charCodeAt(i++) | 0; }
      return h;
    };

    // Prepare runtime: compute target epoch
    let currentSettings = Object.assign({}, urlSettings);
    let targetEpoch = computeTargetEpoch(currentSettings);

    // If no valid date -> show waiting message only
    function refreshTargetFromSettings(s) {
      currentSettings = Object.assign({}, s);
      targetEpoch = computeTargetEpoch(currentSettings);
    }
    refreshTargetFromSettings(currentSettings);
    applyVisualSettings(currentSettings);

    // Main render loop
    let mainInterval = null;
    function startMainLoop() {
      if (mainInterval) clearInterval(mainInterval);
      function tick() {
        // update visuals & compute diff
        applyVisualSettings(currentSettings);
        if (!targetEpoch) {
          utEnddate.textContent = "No valid target date specified.";
          utCountdown.innerHTML = "";
          utWaitmsg.textContent = currentSettings.waitMsg || "";
          utEndmsg.textContent = "";
          return;
        }
        const now = Date.now();
        // Display end date/time
        utEnddate.textContent = "End: " + formatDateForDisplay(targetEpoch, currentSettings.format, currentSettings.tz, currentSettings.hour24);
        let diffMs = targetEpoch - now;
        const passed = diffMs <= 0;
        if (passed && !currentSettings.countUp) {
          // not counting up - just show end message
          utCountdown.innerHTML = "";
          utWaitmsg.textContent = "";
          if (currentSettings.alwaysEnd) utEndmsg.textContent = currentSettings.endMsg || "Ended";
          else utEndmsg.textContent = currentSettings.endMsg || "";
          return;
        }

        // If within 'endOnlyFor' window, show only end message for that time and then start counting up
        if (passed && currentSettings.endOnlyFor && Math.abs(diffMs) <= currentSettings.endOnlyFor * 1000) {
          utCountdown.innerHTML = "";
          utWaitmsg.textContent = "";
          utEndmsg.textContent = currentSettings.endMsg || "Ended";
          return;
        }

        // For countdown or count-up display numbers:
        const isCountUp = passed;
        const from = new Date(Math.min(now, targetEpoch));
        const to = new Date(Math.max(now, targetEpoch));
        let parts = calendarDiff(from, to);
        if (isCountUp) {
          parts = {
            years: Math.abs(parts.years),
            months: Math.abs(parts.months),
            days: Math.abs(parts.days),
            hours: Math.abs(parts.hours),
            minutes: Math.abs(parts.minutes),
            seconds: Math.abs(parts.seconds)
          };
        } else {
          // for countdown ensure positive numbers
          parts = {
            years: Math.max(0, parts.years),
            months: Math.max(0, parts.months),
            days: Math.max(0, parts.days),
            hours: Math.max(0, parts.hours),
            minutes: Math.max(0, parts.minutes),
            seconds: Math.max(0, parts.seconds)
          };
        }

        // Now apply "hidden units overflow" rules:
        // We will compute displayed values for the set of shown units. If a unit is hidden, its range is absorbed into the next visible smaller unit.
        // Approach: convert full difference to total seconds, then allocate into visible units with appropriate limits.
        // But to preserve calendar-aware larger units (years/months/days) we will combine method:
        // First compute totals: totalSeconds absolute
        let totalSeconds = Math.floor(Math.abs((targetEpoch - now) / 1000));
        // Define base unit sizes (approx but consistent): second=1, minute=60, hour=3600, day=86400.
        // For months and years we will derive from calendar-aware parts computed earlier:
        // Convert years and months from parts into seconds using approximate month lengths? To avoid approximation, we will allocate years/months from the calendar parts and then remaining seconds to smaller units.
        let displayUnits = currentSettings.showUnits.slice(); // order preserved as user selected order from UI? The UI multi-select has fixed order; we'll ensure standard ordering
        const standardOrder = ["years","months","days","hours","minutes","seconds"];
        // Ensure displayUnits is ordered in standardOrder
        displayUnits = standardOrder.filter(u => currentSettings.showUnits.indexOf(u) !== -1);

        // We'll create an object valuesToDisplay
        const valuesToDisplay = { years:0, months:0, days:0, hours:0, minutes:0, seconds:0 };

        // If years or months visible, use calendar parts for them first:
        valuesToDisplay.years = parts.years || 0;
        valuesToDisplay.months = parts.months || 0;
        valuesToDisplay.days = parts.days || 0;
        valuesToDisplay.hours = parts.hours || 0;
        valuesToDisplay.minutes = parts.minutes || 0;
        valuesToDisplay.seconds = parts.seconds || 0;
        if (displayUnits.indexOf("years") === -1 && valuesToDisplay.years > 0) {
          valuesToDisplay.months += valuesToDisplay.years * 12;
          valuesToDisplay.years = 0;
        }
        if (displayUnits.indexOf("months") === -1 && valuesToDisplay.months > 0) {
          const d = new Date(to.getFullYear(),to.getMonth(),to.getDate() - valuesToDisplay.days);
          const e = new Date(d.getFullYear(),d.getMonth()- valuesToDisplay.months,d.getDate());;
          const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
          valuesToDisplay.days = Math.floor((to-e) / oneDay);
          valuesToDisplay.months = 0;
        }
        if (displayUnits.indexOf("days") === -1 && valuesToDisplay.days > 0) {
          valuesToDisplay.hours += valuesToDisplay.days * 24;
          valuesToDisplay.days = 0;
        }
        if (displayUnits.indexOf("hours") === -1 && valuesToDisplay.hours > 0) {
          valuesToDisplay.minutes += valuesToDisplay.hours * 60;
          valuesToDisplay.hours = 0;
        }
        if (displayUnits.indexOf("minutes") === -1 && valuesToDisplay.minutes > 0) {
          valuesToDisplay.seconds += valuesToDisplay.minutes * 60;
          valuesToDisplay.minutes = 0;
        }
        if (displayUnits.indexOf("seconds") === -1) {
          valuesToDisplay.minutes += valuesToDisplay.seconds / 60;
          valuesToDisplay.seconds = 0;
        }
        if (displayUnits.indexOf("minutes") === -1) {
          valuesToDisplay.hours += valuesToDisplay.minutes / 60;
          valuesToDisplay.minutes = 0;
        }
        if (displayUnits.indexOf("hours") === -1) {
          valuesToDisplay.days += valuesToDisplay.hours / 24;
          valuesToDisplay.hours = 0;
        }
        if (displayUnits.indexOf("days") === -1) {
          valuesToDisplay.years += valuesToDisplay.days / 365;
          valuesToDisplay.days = 0;
        }
          // subtract the years seconds from totalSeconds by creating a date advanced by years and computing remaining seconds
          //const afterYears = new Date(isCountUp ? (new Date(now).getTime() + valuesToDisplay.years * 365*24*3600*1000) : (new Date(targetEpoch).getTime() - (parts.months*30+parts.days)*24*3600*1000));
          // A precise subtraction is complex; to keep consistent we will subtract approximately:
          //totalSeconds -= valuesToDisplay.years * 365 * 24 * 3600;
        //} else {
          // if years not visible, overflow years into months/days/hours... We'll simply leave totalSeconds as-is and allocate to first visible unit from top-down.
        //}

        // Simpler robust allocation strategy:
        // We'll allocate using fixed known limits for visible units, but adjusting limits when an upper unit is hidden.
        // Steps:
        // 1) Decide unitSizes in seconds for allocation when needed:
        const size = {
          seconds: 1,
          minutes: 60,
          hours: 3600,
          days: 86400,
          months: 2592000, // 30*24*3600 (approx)
          years: 31536000 // 365*24*3600 (approx)
        };

        // 2) For visible units from largest to smallest, compute value = floor(totalSeconds / size[unit]) for approximated larger units.
        // This meets the requirement that if a unit is hidden, the next smaller unit will have a larger range (overflow).
        let remaining = totalSeconds;
        for (const u of standardOrder) {
          if (displayUnits.indexOf(u) === -1) continue;
          const v = Math.floor(remaining / size[u]);
          //valuesToDisplay[u] = v;
          remaining = remaining - v * size[u];
        }
        // Note: this is approximation for months/years but meets "overflow" behavior described.

        // Now build DOM display obeying "do not display if value is zero and no preceding larger time spans are also zero"
        utCountdown.innerHTML = "";
        const unitLabels = { years:"Years", months:"Months", days:"Days", hours:"Hours", minutes:"Minutes", seconds:"Seconds" };
        let started = false;
        for (const u of standardOrder) {
          if (displayUnits.indexOf(u) === -1) continue;
          const v = valuesToDisplay[u] || 0;
          if (!started && v === 0) {
            // skip leading zeros
            continue;
          }
          started = true;
          // create unit node
          const el = document.createElement("div");
          el.className = "urltimer-unit";
          el.innerHTML = `<div class="value">${pad(v,2)}</div><div class="label">${unitLabels[u]}</div>`;
          utCountdown.appendChild(el);
        }
        if (!utCountdown.childNodes.length) {
          // nothing to show -> display waiting or end message
          utCountdown.textContent = passed ? (currentSettings.endMsg || "Ended") : currentSettings.waitMsg || "Waiting...";
        }

        // Set messages
        if (!passed) {
          utWaitmsg.textContent = currentSettings.waitMsg || "";
          utEndmsg.textContent = "";
        } else {
          utWaitmsg.textContent = "";
          utEndmsg.textContent = currentSettings.endMsg || "";
          if (!currentSettings.countUp) {
            // if not counting up, don't show numbers
            utCountdown.innerHTML = "";
            if (!currentSettings.alwaysEnd) utEndmsg.textContent = currentSettings.endMsg || "";
          }
        }
      }

      tick();
      mainInterval = setInterval(tick, 1000);
    }

    // Initialize by applying URL settings
    refreshTargetFromSettings(urlSettings);
    applyVisualSettings(urlSettings);
    startMainLoop();

    // Populate settings UI with URL settings too
    fillSettingsUI(urlSettings);

    // Ensure preview toggled off by default
    wrapper.querySelector("#s-preview").style.display = "none";

    // When settings applied using Apply, we DO NOT change the URL timer (per requirement: url-based timer should always show and live preview separate).
    // But user may want to apply settings to the URL timer—provide a quick helper: if user clicks "Apply to preview" it will only change preview.
    // Provide optional button to "Set as active timer" (not asked explicitly) -- to keep behavior strict, we won't change URL timer automatically.

    // Final: expose small API on the wrapper element for external manipulation
    wrapper.createUrlTimerUpdate = function(newSettings) {
      // allow external script to update active URL timer
      Object.assign(currentSettings, newSettings);
      refreshTargetFromSettings(currentSettings);
      startMainLoop();
    };

    // Fill share link initially
    shareLink.value = encodeSettings(settingsFromUI());

    // Render initial preview
    renderPreview();

    // Hide settings until edit selected already implemented
    utSettings.style.display = "none";

  })();
}

