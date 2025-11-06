---
layout: default
title: Calendar
category: Web_Scripts
order: 1
---
<div id=app></div>
<script>

/**
 * Single-function, dependency-free Calendar with ICS import/export, recurrence, overrides, VTIMEZONE, multi-source overlays, and full UI.
 * Drop-in usage: SingleCalendar(document.body) or SingleCalendar(document.getElementById('app'))
 */
function SingleCalendar(mountNode) {
  // ---- State Manager ----
  const state = {
    view: 'month', // 'year' | 'month' | 'week' | 'day'
    anchor: new Date(),
    events: [], // normalized events
    sources: [], // [{id, name, color, icsText, vtimezones}]
    overrides: new Map(), // key: `${uid}::${isoLocalDate}` => override event object
    tzdb: new Map(), // TZID -> {transitions:[{start:Date, offsetMinutes:number}]}
    drag: null, // drag state
    safetyCap: 1000,
  };
  restoreLocal();

  // ---- Utilities ----
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const toLocalDateISO = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);
  const addDays = (d, days) => {
    const r = new Date(d);
    r.setDate(r.getDate() + days);
    return r;
  };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const startOfWeek = (d) => {
    const r = new Date(d);
    const day = (r.getDay() + 6) % 7; // Monday=0
    r.setDate(r.getDate() - day);
    r.setHours(0, 0, 0, 0);
    return r;
  };
  const endOfWeek = (d) => addMinutes(addDays(startOfWeek(d), 7), -1);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => addMinutes(new Date(d.getFullYear(), d.getMonth() + 1, 1), -1);
  const isAllDaySpan = (ev) => !!ev.allDay;

  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

  // ---- Timezone Resolver ----
  function getOffsetMinutes(tzid, date) {
    if (!tzid || !state.tzdb.has(tzid)) return null;
    const zone = state.tzdb.get(tzid);
    let best = null;
    for (const tr of zone.transitions) {
      if (date >= tr.start && (!tr.end || date < tr.end)) {
        best = tr;
        break;
      }
    }
    if (best) return best.offsetMinutes;
    // Fallback: last transition offset
    if (zone.transitions.length) {
      return zone.transitions[zone.transitions.length - 1].offsetMinutes;
    }
    return null;
  }

  function applyTZID(dateStr, tzid) {
    // dateStr may be YYYYMMDD (all-day local), YYYYMMDDTHHMMSS, or UTC with Z
    if (!tzid) return parseDateValue(dateStr);
    const base = parseDateValue(dateStr, true); // parse naive local time
    const off = getOffsetMinutes(tzid, base);
    if (off == null) return base;
    // Convert local time in TZ to UTC equivalent by subtracting offset
    return addMinutes(base, -off);
  }

  // ---- ICS Parsing Helpers ----
  function unfoldICS(text) {
    return text.replace(/\r?\n[ \t]/g, '');
  }

  function parseParams(name) {
    const out = {};
    const parts = name.split(';').slice(1);
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (k) out[k.toUpperCase()] = (v || '').trim();
    }
    return out;
  }

  function parseDateValue(val, naive = false) {
    // Returns Date in local time if naive=true and not Z; otherwise handle Z as UTC.
    if (/^\d{8}$/.test(val)) {
      const y = +val.slice(0, 4);
      const m = +val.slice(4, 6) - 1;
      const d = +val.slice(6, 8);
      return new Date(y, m, d);
    }
    const hasZ = /Z$/.test(val);
    const y = +val.slice(0, 4);
    const m = +val.slice(4, 6) - 1;
    const d = +val.slice(6, 8);
    const hh = +val.slice(9, 11) || 0;
    const mm = +val.slice(11, 13) || 0;
    const ss = +val.slice(13, 15) || 0;
    if (hasZ && !naive) {
      return new Date(Date.UTC(y, m, d, hh, mm, ss));
    } else {
      return new Date(y, m, d, hh, mm, ss);
    }
  }

  function formatICSDateUTC(date) {
    const z = new Date(date.getTime());
    const y = z.getUTCFullYear();
    const m = pad(z.getUTCMonth() + 1);
    const d = pad(z.getUTCDate());
    const hh = pad(z.getUTCHours());
    const mm = pad(z.getUTCMinutes());
    const ss = pad(z.getUTCSeconds());
    return `${y}${m}${d}T${hh}${mm}${ss}Z`;
  }

  function formatICSDateLocalDay(date) {
    if(typeof date === "string") date = new Date(date);
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    return `${y}${m}${d}`;
  }

  // ---- VTIMEZONE Parser (basic offset transitions) ----
  function parseVTIMEZONE(block) {
    // Simplified: detect STANDARD/DAYLIGHT with TZOFFSETFROM/TZOFFSETTO, DTSTART, optional RRULE for yearly transitions
    const tzidMatch = block.match(/TZID:([^\r\n]+)/i);
    const tzid = tzidMatch ? tzidMatch[1].trim() : null;
    if (!tzid) return null;

    const sections = [];
    const reSection = /BEGIN:(STANDARD|DAYLIGHT)([\s\S]*?)END:\1/gim;
    let m;
    while ((m = reSection.exec(block))) {
      const kind = m[1].toUpperCase();
      const body = m[2];
      const tzfrom = body.match(/TZOFFSETFROM:([+\-]\d{4})/i);
      const tzto = body.match(/TZOFFSETTO:([+\-]\d{4})/i);
      const dtstart = body.match(/DTSTART(:|;[^:]*:)([^\r\n]+)/i);
      const rrule = body.match(/RRULE:([^\r\n]+)/i);
      const toMinutes = (s) => {
        const sign = s[0] === '-' ? -1 : 1;
        const hh = +s.slice(1, 3);
        const mm = +s.slice(3, 5);
        return sign * (hh * 60 + mm);
      };
      if (tzfrom && tzto && dtstart) {
        const offsetTo = toMinutes(tzto[1]);
        const dtStr = dtstart[2].trim();
        const startLocal = parseDateValue(dtStr, true);
        sections.push({
          kind,
          offsetMinutes: offsetTo,
          startLocal,
          rrule: rrule ? rrule[1].trim() : null,
        });
      }
    }

    // Build transitions for a reasonable year range
    const now = new Date();
    const yearStart = now.getFullYear() - 5;
    const yearEnd = now.getFullYear() + 7;
    const transitions = [];

    function expandTransition(sec) {
      if (!sec.rrule) {
        transitions.push({
          start: sec.startLocal,
          offsetMinutes: sec.offsetMinutes,
        });
        return;
      }
      // Only support yearly RRULE with BYMONTH, BYDAY
      const params = Object.fromEntries(
        sec.rrule.split(';').map((p) => {
          const [k, v] = p.split('=');
          return [k.toUpperCase(), v];
        })
      );
      const bymonth = params.BYMONTH ? params.BYMONTH.split(',').map((n) => +n) : [];
      const byday = params.BYDAY ? params.BYDAY.split(',') : [];
      for (let y = yearStart; y <= yearEnd; y++) {
        for (const bm of bymonth.length ? bymonth : [sec.startLocal.getMonth() + 1]) {
          // BYDAY like -1SU or 2SU
          for (const bd of byday.length ? byday : [null]) {
            let target = null;
            if (bd) {
              const match = bd.match(/(-?\d)?(MO|TU|WE|TH|FR|SA|SU)/);
              const nth = match[1] ? parseInt(match[1], 10) : null;
              const wd = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(match[2]);
              target = nthWeekdayOfMonth(y, bm - 1, wd, nth);
            } else {
              target = new Date(y, bm - 1, sec.startLocal.getDate(), sec.startLocal.getHours(), sec.startLocal.getMinutes(), sec.startLocal.getSeconds());
            }
            transitions.push({
              start: target,
              offsetMinutes: sec.offsetMinutes,
            });
          }
        }
      }
    }

    for (const sec of sections) expandTransition(sec);

    // Sort and add end bounds
    transitions.sort((a, b) => a.start - b.start);
    for (let i = 0; i < transitions.length; i++) {
      transitions[i].end = transitions[i + 1] ? transitions[i + 1].start : null;
    }

    return { tzid, transitions };
  }

  function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
    // weekday: 0=Sunday ... 6=Saturday, nth: 1..5 or -1
    if (nth === -1) {
      const last = new Date(year, monthIndex + 1, 0); // last day
      let d = new Date(last);
      while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
      return d;
    } else {
      const first = new Date(year, monthIndex, 1);
      let d = new Date(first);
      while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
      d.setDate(d.getDate() + (nth - 1) * 7);
      return d;
    }
  }

  // ---- ICS Parser ----
  function importICS(icsText, sourceName = 'Imported') {
    const unfolded = unfoldICS(icsText);
    const vtzBlocks = unfolded.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gim) || [];
    const tzids = [];
    for (const block of vtzBlocks) {
      const tz = parseVTIMEZONE(block);
      if (tz) {
        state.tzdb.set(tz.tzid, tz);
        tzids.push(tz.tzid);
      }
    }
    const sourceId = uuid();
    const color = pickColor(state.sources.length);
    state.sources.push({ id: sourceId, name: sourceName, color, vtimezones: tzids, icsText });
    const vevents = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gim) || [];
    for (const evt of vevents) parseVEVENT(evt, sourceId);
    render();
  }

  function pickColor(i) {
    const palette = [
      '#1E88E5',
      '#43A047',
      '#E53935',
      '#8E24AA',
      '#FB8C00',
      '#00ACC1',
      '#7CB342',
      '#F4511E',
      '#3949AB',
      '#00897B',
    ];
    return palette[i % palette.length];
  }

  function parseProp(line) {
    const idx = line.indexOf(':');
    const lhs = line.slice(0, idx);
    const rhs = line.slice(idx + 1);
    const [name, ...rest] = lhs.split(';');
    const params = parseParams(lhs);
    return { name: name.toUpperCase(), params, value: rhs };
  }

  function parseVEVENT(block, sourceId) {
    const lines = block.split(/\r?\n/).filter((l) => l && !/BEGIN|END/.test(l));
    const ev = {
      uid: uuid(),
      sourceId,
      summary: '',
      description: '',
      location: '',
      dtstart: null,
      dtend: null,
      allDay: false,
      tzidStart: null,
      tzidEnd: null,
      rrule: null,
      exdate: [],
      rdate: [],
      sequence: 0,
      recurrenceId: null, // Date
    };

    for (const l of lines) {
      const { name, params, value } = parseProp(l);
      if (name === 'UID') ev.uid = value.trim();
      else if (name === 'SUMMARY') ev.summary = value.trim();
      else if (name === 'DESCRIPTION') ev.description = value.trim();
      else if (name === 'LOCATION') ev.location = value.trim();
      else if (name === 'DTSTART') {
        ev.tzidStart = params.TZID || null;
        ev.dtstart = params.TZID ? applyTZID(value.trim(), params.TZID) : parseDateValue(value.trim());
        ev.allDay = /^\d{8}$/.test(value.trim());
      } else if (name === 'DTEND') {
        ev.tzidEnd = params.TZID || null;
        ev.dtend = params.TZID ? applyTZID(value.trim(), params.TZID) : parseDateValue(value.trim());
      } else if (name === 'RRULE') {
        ev.rrule = value.trim();
      } else if (name === 'EXDATE') {
        // Multiple comma-separated dates
        const tz = params.TZID || ev.tzidStart;
        value.split(',').forEach((v) => {
          const d = tz ? applyTZID(v.trim(), tz) : parseDateValue(v.trim());
          ev.exdate.push(d);
        });
      } else if (name === 'RDATE') {
        const tz = params.TZID || ev.tzidStart;
        value.split(',').forEach((v) => {
          const d = tz ? applyTZID(v.trim(), tz) : parseDateValue(v.trim());
          ev.rdate.push(d);
        });
      } else if (name === 'RECURRENCE-ID') {
        const tz = params.TZID || ev.tzidStart;
        ev.recurrenceId = tz ? applyTZID(value.trim(), tz) : parseDateValue(value.trim());
      } else if (name === 'SEQUENCE') {
        ev.sequence = parseInt(value.trim(), 10) || 0;
      }
    }

    // Overrides handling: If RECURRENCE-ID present, store as override
    if (ev.recurrenceId) {
      const key = `${ev.uid}::${toLocalDateISO(new Date(ev.recurrenceId))}`;
      state.overrides.set(key, ev);
    } else {
      state.events.push(ev);
    }
  }

  // ---- Recurrence Expansion ----
  function expandEvent(ev, rangeStart, rangeEnd) {
    if (!ev.rrule) {
      if (ev.dtend == null && !ev.allDay) {
        ev.dtend = addMinutes(ev.dtstart, 60);
      }
      if (ev.dtstart <= rangeEnd && (ev.dtend || ev.dtstart) >= rangeStart) {
        const inst = applyOverride(ev, ev.dtstart);
        return [inst];
      }
      return [];
    }

    const params = Object.fromEntries(
      ev.rrule.split(';').map((p) => {
        const [k, v] = p.split('=');
        return [k.toUpperCase(), v];
      })
    );
    const FREQ = (params.FREQ || '').toUpperCase();
    const INTERVAL = parseInt(params.INTERVAL || '1', 10);
    const COUNT = params.COUNT ? parseInt(params.COUNT, 10) : null;
    const UNTIL = params.UNTIL ? parseDateValue(params.UNTIL) : null;
    const BYMONTH = params.BYMONTH ? params.BYMONTH.split(',').map((n) => +n) : null;
    const BYDAY = params.BYDAY ? params.BYDAY.split(',') : null;

    const out = [];
    let c = 0;

    const addInstance = (start) => {
      const inst = applyOverride(ev, start);
      // Derive end based on original duration
      const durMs = (ev.dtend || ev.dtstart).getTime() - ev.dtstart.getTime();
      inst.dtstart = start;
      inst.dtend = new Date(start.getTime() + durMs);
      inst.allDay = ev.allDay;
      out.push(inst);
    };

    const baseStart = new Date(ev.dtstart);
    const isInRange = (d) => d <= rangeEnd && d >= addMinutes(rangeStart, -1);

    function passFilters(d) {
      if (BYMONTH && BYMONTH.length && BYMONTH.indexOf(d.getMonth() + 1) === -1) return false;
      if (BYDAY && BYDAY.length) {
        const wdNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const wd = wdNames[d.getDay()];
        // For monthly/yearly nth BYDAY, we need to compute matches.
        // If BYDAY has nth spec, ensure d matches nth in month.
        // If simple BYDAY, just match weekday.
        const passes = BYDAY.some((spec) => {
          const m = spec.match(/(-?\d)?(MO|TU|WE|TH|FR|SA|SU)/);
          if (!m) return false;
          const nth = m[1] ? parseInt(m[1], 10) : null;
          const dayName = m[2];
          if (nth == null) {
            return wd === dayName;
          } else {
            // Compute nth occurrence
            const target = nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), ['SU','MO','TU','WE','TH','FR','SA'].indexOf(dayName), nth);
            return isSameDay(d, target);
          }
        });
        if (!passes) return false;
      }
      // EXDATE
      if (ev.exdate && ev.exdate.some((ex) => isSameDay(ex, d))) return false;
      return true;
    }

    // Include RDATE instances explicitly
    for (const r of ev.rdate || []) {
      if (r >= rangeStart && r <= rangeEnd) addInstance(startOfDay(r));
    }

    let cursor = new Date(baseStart);
    let safety = 0;

    function step(d) {
      if (FREQ === 'DAILY') return addDays(d, INTERVAL);
      if (FREQ === 'WEEKLY') return addDays(d, INTERVAL * 7);
      if (FREQ === 'MONTHLY') {
        const nd = new Date(d);
        nd.setMonth(nd.getMonth() + INTERVAL);
        return nd;
      }
      if (FREQ === 'YEARLY') {
        const nd = new Date(d);
        nd.setFullYear(nd.getFullYear() + INTERVAL);
        return nd;
      }
      return addDays(d, INTERVAL);
    }

    while (safety++ < state.safetyCap) {
      if (UNTIL && cursor > UNTIL) break;
      if (COUNT && c >= COUNT) break;
      if (passFilters(cursor)) {
        if (isInRange(cursor)) addInstance(cursor);
        c++;
      }
      cursor = step(cursor);
      if (cursor > rangeEnd && COUNT == null) {
        // We can stop after passing rangeEnd for non-count limited
        break;
      }
    }

    // Apply overrides already handled via addInstance.
    return out;
  }

  function applyOverride(ev, occStart) {
    const key = `${ev.uid}::${toLocalDateISO(new Date(occStart))}`;
    if (state.overrides.has(key)) {
      const o = state.overrides.get(key);
      return {
        ...ev,
        summary: o.summary || ev.summary,
        description: o.description || ev.description,
        location: o.location || ev.location,
        dtstart: o.dtstart || occStart,
        dtend: o.dtend || (ev.dtend ? addMinutes(occStart, (ev.dtend - ev.dtstart) / 60000) : occStart),
        allDay: o.allDay != null ? o.allDay : ev.allDay,
      };
    }
    return { ...ev, dtstart: occStart, dtend: ev.dtend ? addMinutes(occStart, (ev.dtend - ev.dtstart) / 60000) : occStart };
  }

  // ---- ICS Exporter ----
  function exportICS() {
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//SingleFunctionCalendar//EN');

    // Emit VTIMEZONEs
    const emitted = new Set();
    for (const src of state.sources) {
      for (const tzid of src.vtimezones || []) {
        if (emitted.has(tzid)) continue;
        emitted.add(tzid);
        const tz = state.tzdb.get(tzid);
        if (!tz) continue;
        // Best-effort serialize current standard/daylight offsets
        const now = new Date();
        const current = tz.transitions.find((t) => !t.end || (now >= t.start && now < t.end)) || tz.transitions[0];
        const off = current.offsetMinutes;
        const sign = off < 0 ? '-' : '+';
        const hh = pad(Math.floor(Math.abs(off) / 60));
        const mm = pad(Math.abs(off) % 60);
        lines.push('BEGIN:VTIMEZONE');
        lines.push(`TZID:${tzid}`);
        lines.push('BEGIN:STANDARD');
        lines.push(`TZOFFSETFROM:${sign}${hh}${mm}`);
        lines.push(`TZOFFSETTO:${sign}${hh}${mm}`);
        lines.push(`DTSTART:${formatICSDateLocalDay(current.start)}`);
        lines.push('END:STANDARD');
        lines.push('END:VTIMEZONE');
      }
    }

    for (const ev of state.events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${ev.uid}`);
      if (ev.allDay) {
        lines.push(`DTSTART:${formatICSDateLocalDay(ev.dtstart)}`);
        if (ev.dtend) lines.push(`DTEND:${formatICSDateLocalDay(ev.dtend)}`);
      } else {
        lines.push(`DTSTART:${formatICSDateUTC(ev.dtstart)}`);
        if (ev.dtend) lines.push(`DTEND:${formatICSDateUTC(ev.dtend)}`);
      }
      if (ev.summary) lines.push(`SUMMARY:${ev.summary}`);
      if (ev.description) lines.push(`DESCRIPTION:${ev.description}`);
      if (ev.location) lines.push(`LOCATION:${ev.location}`);
      if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
      if (ev.exdate && ev.exdate.length) {
        const vals = ev.exdate
          .map((d) => (ev.allDay ? formatICSDateLocalDay(d) : formatICSDateUTC(d)))
          .join(',');
        lines.push(`EXDATE:${vals}`);
      }
      if (ev.rdate && ev.rdate.length) {
        const vals = ev.rdate
          .map((d) => (ev.allDay ? formatICSDateLocalDay(d) : formatICSDateUTC(d)))
          .join(',');
        lines.push(`RDATE:${vals}`);
      }
      lines.push('END:VEVENT');
    }

    // Overrides as separate VEVENT with RECURRENCE-ID
    for (const [key, o] of state.overrides.entries()) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${o.uid}`);
      const rid = o.recurrenceId || o.dtstart;
      const ridStr = o.allDay ? formatICSDateLocalDay(rid) : formatICSDateUTC(rid);
      lines.push(`RECURRENCE-ID:${ridStr}`);
      if (o.allDay) {
        lines.push(`DTSTART:${formatICSDateLocalDay(o.dtstart)}`);
        if (o.dtend) lines.push(`DTEND:${formatICSDateLocalDay(o.dtend)}`);
      } else {
        lines.push(`DTSTART:${formatICSDateUTC(o.dtstart)}`);
        if (o.dtend) lines.push(`DTEND:${formatICSDateUTC(o.dtend)}`);
      }
      if (o.summary) lines.push(`SUMMARY:${o.summary}`);
      if (o.description) lines.push(`DESCRIPTION:${o.description}`);
      if (o.location) lines.push(`LOCATION:${o.location}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendar.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---- UI Injection ----
  const root = document.createElement('div');
  root.className = 'sfc-root';
  root.innerHTML = `
    <div class="sfc-toolbar">
      <div class="sfc-left">
        <button data-nav="prev">Prev</button>
        <button data-nav="today">Today</button>
        <button data-nav="next">Next</button>
        <select class="sfc-view">
          <option value="year">Year</option>
          <option value="month">Month</option>
          <option value="week">Week</option>
          <option value="day">Day</option>
        </select>
      </div>
      <div class="sfc-right">
        <input type="text" class="sfc-url" placeholder="ICS URL"/>
        <button data-action="import-url">Import URL</button>
        <input type="file" class="sfc-file" accept=".ics,text/calendar"/>
        <button data-action="import-file">Import File</button>
        <button data-action="export">Export ICS</button>
        <button data-action="import-text">Import Text</button>
      </div>
    </div>
    <div class="sfc-legend"></div>
    <div class="sfc-content"></div>
    <div class="sfc-modal-backdrop" style="display:none;">
      <div class="sfc-modal">
        <h3>Edit event</h3>
        <label>Title <input type="text" class="ev-title"/></label>
        <label>Location <input type="text" class="ev-location"/></label>
        <label>Description <textarea class="ev-desc"></textarea></label>
        <label>All-day <input type="checkbox" class="ev-allday"/></label>
        <div class="sfc-datetime-row">
          <label>Start <input type="datetime-local" class="ev-start"/></label>
          <label>End <input type="datetime-local" class="ev-end"/></label>
        </div>
        <label>RRULE <input type="text" class="ev-rrule" placeholder="FREQ=...;INTERVAL=...;BYDAY=...;BYMONTH=..."/></label>
        <label>EXDATE (comma YYYYMMDD or UTC) <input type="text" class="ev-exdate"/></label>
        <label>RDATE (comma YYYYMMDD or UTC) <input type="text" class="ev-rdate"/></label>
        <div class="sfc-modal-actions">
          <button data-action="save">Save</button>
          <button data-action="delete">Delete</button>
          <button data-action="cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
  mountNode.appendChild(root);

  const style = document.createElement('style');
  style.textContent = `
    .sfc-root { font-family: system-ui, Segoe UI, sans-serif; background:#000;color:#ccc; }
    .sfc-root .sfc-toolbar { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
    .sfc-root .sfc-toolbar button, .sfc-root .sfc-toolbar select, .sfc-root .sfc-toolbar input { padding:6px 10px; font-size:14px; }
    .sfc-root .sfc-legend { display:flex; gap:12px; flex-wrap:wrap; margin:8px 0; }
    .sfc-root .sfc-legend .item { display:flex; align-items:center; gap:6px; }
    .sfc-root .sfc-legend .swatch { width:12px; height:12px; border-radius:2px; }
    .sfc-root .sfc-content { border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
    .sfc-root .sfc-grid { display:grid; }
    .sfc-root .sfc-year { grid-template-columns: repeat(3, 1fr); gap:12px; padding:12px; }
    .sfc-root .sfc-month { display:grid; grid-template-columns: repeat(7, 1fr); }
    .sfc-root .sfc-month .cell { border:1px solid #eef2f7; min-height:100px; padding:4px; position:relative; }
    .sfc-root .sfc-month .cell .date { font-size:12px; color:#6b7280; }
    .sfc-root .sfc-month .cell.today { background:#fff7ed; }
    .sfc-root .sfc-month .cell.weekend { background:#fafafa; }
    .sfc-root .sfc-week, .sfc-root .allday { display:grid; grid-template-columns: 80px repeat(7, 1fr); position:relative;}
    .sfc-root .sfc-week .hour-row { display:contents; }
    .sfc-root .sfc-week .timecell { border:1px solid #eef2f7; min-height:40px; position:relative; }
    .sfc-root .allday { grid-column: 1 / -1; display:grid; grid-template-columns: 80px repeat(7, 1fr); background:#f8fafc; }
    .sfc-root .allday .label { border-right:1px solid #e5e7eb; padding:6px; color:#6b7280; }
    .sfc-root .allday .slot { border:1px solid #eef2f7; min-height:28px; position:relative; }
    .sfc-root .sfc-event { position:absolute; border-radius:4px; padding:2px 4px; color:white; font-size:12px; cursor:pointer; overflow:hidden; }
    .sfc-root .sfc-chip { background: currentColor; color:#fff; border-radius:4px; padding:2px 4px; font-size:12px; margin:2px 0; position:relative; }
    .sfc-root .sfc-chip.dragging, .sfc-root .sfc-event.dragging { opacity:0.8; outline:2px dashed #374151; }
    .sfc-root .sfc-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.28); display:flex; align-items:center; justify-content:center; }
    .sfc-root .sfc-modal { background:#fff; padding:16px; border-radius:8px; width:480px; max-width:95vw; box-shadow:0 10px 30px rgba(0,0,0,0.2); }
    .sfc-root .sfc-modal h3 { margin:0 0 12px; }
    .sfc-root .sfc-modal label { display:block; margin:8px 0; }
    .sfc-root .sfc-modal input[type="text"], .sfc-root .sfc-modal input[type="datetime-local"], .sfc-root .sfc-modal textarea { width:100%; padding:6px; }
    .sfc-root .sfc-modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
    .sfc-root .sfc-day { display:grid; grid-template-columns: 80px 1fr;position:relative; }
    .sfc-root .allday-day { grid-column: 1 / -1; display:grid; grid-template-columns: 80px 1fr; background:#f8fafc; }
    .sfc-root .allday-day .label { border-right:1px solid #e5e7eb; padding:6px; color:#6b7280; }
    .sfc-root .allday-day .slot { border:1px solid #eef2f7; min-height:28px; position:relative; }
    .sfc-root .sfc-day .timecell { border:1px solid #eef2f7; min-height:40px; position:relative; }
    .sfc-root .sfc-header { display:grid; grid-template-columns: 80px repeat(7, 1fr); background:#f3f4f6; border-bottom:1px solid #e5e7eb; }
    .sfc-root .sfc-header-day { display:grid; grid-template-columns: 1fr; background:#f3f4f6; border-bottom:1px solid #e5e7eb; }
    .sfc-root .sfc-header .hcell, .sfc-root .sfc-header-day .hcell { padding:8px; text-align:center; font-weight:600; color:#374151; }
    .sfc-root .sfc-year-month { border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
    .sfc-root .sfc-year-month .title { background:#f8fafc; padding:6px 8px; font-weight:600; border-bottom:1px solid #e5e7eb; }
  `;
  document.head.appendChild(style);

  // ---- Legend ----
  function renderLegend() {
    const legend = root.querySelector('.sfc-legend');
    legend.innerHTML = '';
    for (const src of state.sources) {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<span class="swatch" style="background:${src.color}"></span><span>${src.name}</span>`;
      legend.appendChild(item);
    }
  }

  // ---- Renderer ----
  function render() {
    renderLegend();
    const content = root.querySelector('.sfc-content');
    const anchor = new Date(state.anchor);
    const today = new Date();
    const wdNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    if (state.view === 'year') {
      content.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'sfc-year';
      for (let m = 0; m < 12; m++) {
        const monthAnchor = new Date(anchor.getFullYear(), m, 1);
        const monthEl = document.createElement('div');
        monthEl.className = 'sfc-year-month';
        monthEl.innerHTML = `<div class="title">${monthAnchor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>`;
        const grid = document.createElement('div');
        grid.className = 'sfc-month';
        // header row: Mon-Sun
        for (const n of wdNames) {
          const hdr = document.createElement('div');
          hdr.className = 'sfc-header hcell';
          hdr.textContent = n;
          grid.appendChild(hdr);
        }
        // compute start offset
        const first = startOfMonth(monthAnchor);
        const offset = ((first.getDay() + 6) % 7);
        const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
        const totalCells = offset + daysInMonth;
        for (let i = 0; i < offset; i++) {
          const empty = document.createElement('div');
          empty.className = 'cell';
          grid.appendChild(empty);
        }
        const rangeStart = startOfMonth(monthAnchor);
        const rangeEnd = endOfMonth(monthAnchor);
        const occs = occurrencesInRange(rangeStart, rangeEnd);
        for (let d = 1; d <= daysInMonth; d++) {
          const date = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), d);
          const cell = document.createElement('div');
          cell.className = 'cell' + (isSameDay(date, today) ? ' today' : '') + (((date.getDay()+6)%7)>=5 ? ' weekend' : '');
          cell.innerHTML = `<div class="date">${d}</div>`;
          cell.addEventListener('dblclick', () => openEditor({ dtstart: startOfDay(date), dtend: endOfDay(date), allDay: true }));
          const dayEvents = occs.filter((e) => e.dtstart <= endOfDay(date) && e.dtend >= startOfDay(date));
          dayEvents.sort((a, b) => a.dtstart - b.dtstart);
          let count = 0;
          for (const e of dayEvents) {
            if (count === 5) {
              const chip = document.createElement('div');
              chip.className = 'sfc-chip';
              chip.style.color = sourceColor(e.sourceId);
              chip.textContent = `+${dayEvents.length - count} more`;
              cell.appendChild(chip);
              break;
            }
            const chip = document.createElement('div');
            chip.className = 'sfc-chip';
            chip.style.color = sourceColor(e.sourceId);
            chip.textContent = e.summary || '(untitled)';
            chip.addEventListener('click', () => openEditor(e));
            enableDragChip(chip, e, date);
            cell.appendChild(chip);
            count++;
          }
          grid.appendChild(cell);
        }
        monthEl.appendChild(grid);
        wrap.appendChild(monthEl);
      }
      content.appendChild(wrap);
      //return;
    }

    if (state.view === 'month') {
      content.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'sfc-month';
      // header row
      for (const n of wdNames) {
        const hdr = document.createElement('div');
        hdr.className = 'sfc-header hcell';
        hdr.textContent = n;
        grid.appendChild(hdr);
      }
      const first = startOfMonth(anchor);
      const offset = ((first.getDay() + 6) % 7);
      const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      const rangeStart = startOfMonth(anchor);
      const rangeEnd = endOfMonth(anchor);
      const occs = occurrencesInRange(rangeStart, rangeEnd);
      for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('div'));
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(anchor.getFullYear(), anchor.getMonth(), d);
        const cell = document.createElement('div');
        cell.className = 'cell' + (isSameDay(date, today) ? ' today' : '') + (((date.getDay()+6)%7)>=5 ? ' weekend' : '');
        cell.innerHTML = `<div class="date">${d}</div>`;
        cell.addEventListener('dblclick', () => openEditor({ dtstart: startOfDay(date), dtend: endOfDay(date), allDay: true }));
        const dayEvents = occs.filter((e) => e.dtstart <= endOfDay(date) && e.dtend >= startOfDay(date));
        dayEvents.sort((a, b) => a.dtstart - b.dtstart);
        let count = 0;
        for (const e of dayEvents) {
          if (count === 5) {
            const chip = document.createElement('div');
            chip.className = 'sfc-chip';
            chip.style.color = sourceColor(e.sourceId);
            chip.textContent = `+${dayEvents.length - count} more`;
            cell.appendChild(chip);
            break;
          }
          const chip = document.createElement('div');
          chip.className = 'sfc-chip';
          chip.style.color = sourceColor(e.sourceId);
          chip.textContent = e.summary || '(untitled)';
          chip.addEventListener('click', () => openEditor(e));
          enableDragChip(chip, e, date);
          cell.appendChild(chip);
          count++;
        }
        grid.appendChild(cell);
      }
      content.appendChild(grid);
      //return;
    }

    if (state.view === 'week') {
      content.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'sfc-week';
      const weekStart = startOfWeek(anchor);
      const weekEnd = endOfWeek(anchor);
      const occs = occurrencesInRange(weekStart, weekEnd);

      // Header
      const header = document.createElement('div');
      header.className = 'sfc-header';
      header.appendChild(document.createElement('div'));
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        const hc = document.createElement('div');
        hc.className = 'hcell';
        hc.textContent = `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;
        header.appendChild(hc);
      }
      content.appendChild(header);

      // All-day row
      const allday = document.createElement('div');
      allday.className = 'allday';
      const lbl = document.createElement('div');
      lbl.className = 'label';
      lbl.textContent = 'All-day';
      allday.appendChild(lbl);
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        const slot = document.createElement('div');
        slot.className = 'slot' + (isSameDay(d, today) ? ' today' : '');
        slot.addEventListener('dblclick', () => openEditor({ dtstart: startOfDay(d), dtend: endOfDay(d), allDay: true }));
        const dayEvents = occs.filter((e) => e.allDay && e.dtstart <= endOfDay(d) && e.dtend >= startOfDay(d));
        for (const e of dayEvents) {
          const chip = document.createElement('div');
          chip.className = 'sfc-chip';
          chip.style.color = sourceColor(e.sourceId);
          chip.textContent = e.summary || '(untitled)';
          chip.addEventListener('click', () => openEditor(e));
          enableDragChip(chip, e, d);
          slot.appendChild(chip);
        }
        allday.appendChild(slot);
      }
      content.appendChild(allday);

      // Hour grid
      for (let hour = 0; hour < 24; hour++) {
        const label = document.createElement('div');
        label.className = 'timecell';
        label.textContent = `${pad(hour)}:00`;
        wrap.appendChild(label);
        for (let i = 0; i < 7; i++) {
          const d = addDays(weekStart, i);
          const tc = document.createElement('div');
          tc.className = 'timecell' + (isSameDay(d, today) ? ' today' : '');
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0);
          const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour+1, 0, 0);
          tc.addEventListener('dblclick', () => {
            openEditor({ dtstart: start, dtend: addMinutes(start, 60), allDay: false });
          });
          //const weekStart = startOfWeek(anchor);
          //const weekEnd = endOfWeek(anchor);
          //const hrOccs = occurrencesInRange(weekStart, weekEnd);
          for (const e of occs.filter((x) => !x.allDay && (x.dtstart >= start) && (x.dtstart < end))) {
            //placeTimedEvent(e, weekStart, wrap);
            const chip = document.createElement('div');
            chip.className = 'sfc-chip';
            chip.style.background = sourceColor(e.sourceId);
            chip.textContent = e.summary || '(untitled)';
            chip.addEventListener('click', () => openEditor(e));
            enableDragChip(chip, e, d);
            tc.appendChild(chip);
          }
          wrap.appendChild(tc);
        }
      }
      content.appendChild(wrap);

      // Place timed events
      //for (const e of occs.filter((x) => !x.allDay)) {
      //  placeTimedEvent(e, weekStart, wrap);
      //}
      //return;
    }

    if (state.view === 'day') {
      content.innerHTML = '';
      const dayStart = startOfDay(anchor);
      const dayEnd = endOfDay(anchor);
      const occs = occurrencesInRange(dayStart, dayEnd);

      // Header
      const header = document.createElement('div');
      header.className = 'sfc-header-day';
      const hc = document.createElement('div');
      hc.className = 'hcell';
      hc.textContent = anchor.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
      header.appendChild(hc);
      content.appendChild(header);

      // All-day
      const allday = document.createElement('div');
      allday.className = 'allday-day';
      const lbl = document.createElement('div');
      lbl.className = 'label';
      lbl.textContent = 'All-day';
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.addEventListener('dblclick', () => openEditor({ dtstart: dayStart, dtend: dayEnd, allDay: true }));
      for (const e of occs.filter((x) => x.allDay)) {
        const chip = document.createElement('div');
        chip.className = 'sfc-chip';
        chip.style.color = sourceColor(e.sourceId);
        chip.textContent = e.summary || '(untitled)';
        chip.addEventListener('click', () => openEditor(e));
        enableDragChip(chip, e, dayStart);
        slot.appendChild(chip);
      }
      allday.appendChild(lbl);
      allday.appendChild(slot);
      content.appendChild(allday);

      // Hour grid
      const grid = document.createElement('div');
      grid.className = 'sfc-day';
      for (let hour = 0; hour < 24; hour++) {
        const label = document.createElement('div');
        label.className = 'timecell';
        label.textContent = `${pad(hour)}:00`;
        const tc = document.createElement('div');
        tc.className = 'timecell';
        tc.addEventListener('dblclick', () => {
          const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), hour, 0, 0);
          openEditor({ dtstart: start, dtend: addMinutes(start, 60), allDay: false });
        });
        grid.appendChild(label);
        grid.appendChild(tc);
      }
      content.appendChild(grid);

      // Place timed events
      for (const e of occs.filter((x) => !x.allDay)) {
        placeTimedEvent(e, dayStart, grid, true);
      }
      //return;
    }
    saveLocal();
  }

  // ---- LocalStorage Persistence ----
  function saveLocal() {
    try {
      const data = {
        events: state.events,
        sources: state.sources,
        overrides: Array.from(state.overrides.entries()),
        anchor: state.anchor,
        view: state.view,
      };
      localStorage.setItem('singleCalendarState', JSON.stringify(data));
    } catch (e) {
      // Ignore storage errors
    }
    console.log(state);
  }

  function restoreLocal() {
    try {
      const raw = localStorage.getItem('singleCalendarState');
      if (!raw) return;
      const data = JSON.parse(raw);
      state.events = data.events || [];
      state.events.forEach((evt) => {evt.dtstart = new Date(evt.dtstart);evt.dtend = new Date(evt.dtend);});
      state.sources = data.sources || [];
      state.overrides = new Map(data.overrides || []);
      state.anchor = data.anchor ? new Date(data.anchor) : new Date();
      state.view = data.view || 'month';
    } catch (e) {
      // Ignore parse errors
    }
  }


  function sourceColor(sourceId) {
    const s = state.sources.find((x) => x.id === sourceId);
    return s ? s.color : '#374151';
  }

  function occurrencesInRange(rangeStart, rangeEnd) {
    const out = [];
    for (const ev of state.events) {
      const occs = expandEvent(ev, rangeStart, rangeEnd);
      for (const o of occs) {
        out.push(o);
      }
    }
    // Include overrides that may be standalone (rare)
    return out.sort((a, b) => a.dtstart - b.dtstart);
  }

  function placeTimedEvent(e, weekStartOrDayStart, container, isDay = false) {
    // container has timecells laid out; compute position per day/hour
    const dayCount = isDay ? 1 : 7;
    const hourHeight = 40; // px
    const dayWidthIndex = (d) => {
      const diffDays = Math.floor((startOfDay(d) - startOfDay(weekStartOrDayStart)) / 86400000);
      return Math.max(0, Math.min(diffDays, dayCount - 1));
    };
    const startDayIndex = dayWidthIndex(e.dtstart);
    const startMinutes = e.dtstart.getHours() * 60 + e.dtstart.getMinutes();
    const endMinutes = e.dtend.getHours() * 60 + e.dtend.getMinutes();
    const top = (startMinutes / 60) * hourHeight;
    const height = Math.max(20, ((endMinutes - startMinutes) / 60) * hourHeight);
    const colOffset = isDay ? 1 : 1; // skip time label column

    // Find the target time cell element grid
    // For simplicity, overlay absolute positioned event inside the container
    const evEl = document.createElement('div');
    evEl.className = 'sfc-event';
    evEl.style.background = sourceColor(e.sourceId);
    evEl.style.left = `calc(${((startDayIndex + colOffset) / (dayCount + colOffset)) * 100}% + 4px)`;
    evEl.style.width = `calc(${(1 / (dayCount + colOffset)) * 100}% - 8px)`;
    evEl.style.top = `${top}px`;
    evEl.style.height = `${height}px`;
    evEl.textContent = e.summary || '(untitled)';
    evEl.title = `${e.summary || '(untitled)'}\n${e.dtstart.toLocaleString()} - ${e.dtend.toLocaleString()}`;
    evEl.addEventListener('click', () => openEditor(e));
    enableDragEvent(evEl, e);
    container.appendChild(evEl);
  }

  // ---- Editor ----
  let editorEvent = null;
  function openEditor(ev) {
    editorEvent = ev.recurrenceId ? ev : { ...ev }; // allow editing instances separately
    const modal = root.querySelector('.sfc-modal-backdrop');
    modal.style.display = 'flex';
    root.querySelector('.ev-title').value = ev.summary || '';
    root.querySelector('.ev-location').value = ev.location || '';
    root.querySelector('.ev-desc').value = ev.description || '';
    root.querySelector('.ev-allday').checked = !!ev.allDay;

    const toInput = (d) => {
      const y = d.getFullYear();
      const m = pad(d.getMonth() + 1);
      const da = pad(d.getDate());
      const hh = pad(d.getHours());
      const mm = pad(d.getMinutes());
      return `${y}-${m}-${da}T${hh}:${mm}`;
    };
    root.querySelector('.ev-start').value = toInput(ev.dtstart || new Date());
    root.querySelector('.ev-end').value = toInput(ev.dtend || addMinutes(ev.dtstart || new Date(), 60));
    root.querySelector('.ev-rrule').value = ev.rrule || '';
    root.querySelector('.ev-exdate').value = (ev.exdate || []).map((d) => formatICSDateLocalDay(d)).join(',');
    root.querySelector('.ev-rdate').value = (ev.rdate || []).map((d) => formatICSDateLocalDay(d)).join(',');
  }

  function closeEditor() {
    editorEvent = null;
    root.querySelector('.sfc-modal-backdrop').style.display = 'none';
  }

  function saveEditor() {
    if (!editorEvent) return;
    const title = root.querySelector('.ev-title').value.trim();
    const loc = root.querySelector('.ev-location').value.trim();
    const desc = root.querySelector('.ev-desc').value.trim();
    const allDay = root.querySelector('.ev-allday').checked;
    const ds = new Date(root.querySelector('.ev-start').value);
    const de = new Date(root.querySelector('.ev-end').value);
    const rrule = root.querySelector('.ev-rrule').value.trim() || null;
    const exdateStr = root.querySelector('.ev-exdate').value.trim();
    const rdateStr = root.querySelector('.ev-rdate').value.trim();
    const exdate = exdateStr ? exdateStr.split(',').map((v) => parseDateValue(v.trim())) : [];
    const rdate = rdateStr ? rdateStr.split(',').map((v) => parseDateValue(v.trim())) : [];

    const isExisting = !!editorEvent.uid && state.events.some((x) => x.uid === editorEvent.uid);
    if (editorEvent.recurrenceId) {
      // override instance
      const key = `${editorEvent.uid}::${toLocalDateISO(new Date(editorEvent.recurrenceId))}`;
      const updated = {
        ...editorEvent,
        summary: title,
        location: loc,
        description: desc,
        allDay,
        dtstart: ds,
        dtend: de,
      };
      state.overrides.set(key, updated);
    } else if (isExisting) {
      const idx = state.events.findIndex((x) => x.uid === editorEvent.uid);
      state.events[idx] = {
        ...state.events[idx],
        summary: title,
        location: loc,
        description: desc,
        allDay,
        dtstart: ds,
        dtend: de,
        rrule,
        exdate,
        rdate,
      };
    } else {
      const newEv = {
        uid: uuid(),
        sourceId: state.sources[0]?.id || 'local',
        summary: title,
        location: loc,
        description: desc,
        allDay,
        dtstart: ds,
        dtend: de,
        rrule,
        exdate,
        rdate,
      };
      state.events.push(newEv);
      if (!state.sources.length) {
        state.sources.push({ id: 'local', name: 'Local', color: pickColor(0), vtimezones: [], icsText: '' });
      }
    }
    closeEditor();
    render();
  }

  function deleteEditor() {
    if (!editorEvent) return;
    if (editorEvent.recurrenceId) {
      const key = `${editorEvent.uid}::${toLocalDateISO(new Date(editorEvent.recurrenceId))}`;
      state.overrides.delete(key);
    } else {
      state.events = state.events.filter((x) => x.uid !== editorEvent.uid);
    }
    closeEditor();
    render();
  }

  // ---- Drag & Drop ----
  function enableDragChip(chip, event, dateContext) {
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => {
      state.drag = { event, type: 'chip', srcDate: dateContext };
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      state.drag = null;
    });
    // Allow drop onto other day cells
    const cells = root.querySelectorAll('.sfc-month .cell, .sfc-year .cell, .sfc-week .slot, .sfc-day .slot');
    cells.forEach((cell) => {
      cell.addEventListener('dragover', (ev) => ev.preventDefault());
      cell.addEventListener('drop', (ev) => {
        if (!state.drag || state.drag.type !== 'chip') return;
        const targetDate = inferCellDate(cell);
        if (!targetDate) return;
        const duration = (event.dtend || event.dtstart) - event.dtstart;
        const newStart = startOfDay(targetDate);
        const newEnd = new Date(newStart.getTime() + duration);
        const updated = { ...event, dtstart: newStart, dtend: newEnd, allDay: true };
        updateEvent(updated);
        render();
      });
    });
  }

  function enableDragEvent(evEl, event) {
    evEl.draggable = true;
    evEl.addEventListener('dragstart', () => {
      state.drag = { event, type: 'timed' };
      evEl.classList.add('dragging');
    });
    evEl.addEventListener('dragend', () => {
      evEl.classList.remove('dragging');
      state.drag = null;
    });
    // Drop onto timecell to reassign start by hour/day
    const timecells = root.querySelectorAll('.sfc-week .timecell, .sfc-day .timecell');
    timecells.forEach((tc) => {
      tc.addEventListener('dragover', (ev) => ev.preventDefault());
      tc.addEventListener('drop', (ev) => {
        if (!state.drag || state.drag.type !== 'timed') return;
        const target = inferTimeCellDate(tc);
        if (!target) return;
        const duration = (event.dtend || event.dtstart) - event.dtstart;
        const newStart = target;
        const newEnd = new Date(newStart.getTime() + duration);
        const updated = { ...event, dtstart: newStart, dtend: newEnd, allDay: false };
        updateEvent(updated);
        render();
      });
    });
  }

  function updateEvent(updated) {
    const idx = state.events.findIndex((x) => x.uid === updated.uid);
    if (idx >= 0) state.events[idx] = updated;
  }

  function inferCellDate(cell) {
    // Try to parse the date number from cell context by walking DOM (approximate)
    const dateLabel = cell.querySelector('.date');
    if (dateLabel) {
      // Month/year view: derive from current anchor month/year
      const dayNum = parseInt(dateLabel.textContent, 10);
      // Find surrounding month/year container to get month/year
      // Fallback to anchor
      let scopeDate = new Date(state.anchor);
      const monthTitleEl = cell.closest('.sfc-year-month');
      if (monthTitleEl) {
        const t = monthTitleEl.querySelector('.title').textContent;
        const parts = t.split(' ');
        const monthName = parts[0];
        const yearNum = parseInt(parts[1], 10);
        const m = new Date(`${monthName} 1, ${yearNum}`).getMonth();
        scopeDate = new Date(yearNum, m, 1);
      }
      return new Date(scopeDate.getFullYear(), scopeDate.getMonth(), dayNum);
    }
    return null;
  }

  function inferTimeCellDate(tc) {
    // Use position in grid to map hour/day
    // We simplify: find nearest hour label sibling index
    const text = tc.textContent.trim();
    const m = text.match(/^(\d{2}):00$/);
    const hour = m ? parseInt(m[1], 10) : 0;
    // Determine day index by position: find parent view and compute index
    const content = root.querySelector('.sfc-content');
    const header = content.querySelector('.sfc-header');
    const days = [];
    header.querySelectorAll('.hcell').forEach((hc, i) => {
      const label = hc.textContent;
      const parts = label.split(' ');
      const dayNum = parseInt(parts[parts.length - 1], 10);
      const d = new Date(state.anchor);
      const view = state.view;
      if (view === 'week') {
        const ws = startOfWeek(state.anchor);
        days.push(addDays(ws, i));
      } else {
        days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      }
    });
    // Approx: use bounding rect to pick day index based on left position
    const rect = tc.getBoundingClientRect();
    const parentRect = tc.parentElement.getBoundingClientRect();
    const relX = rect.left - parentRect.left;
    const width = parentRect.width;
    const dayIdx = Math.min(6, Math.max(0, Math.floor((relX / width) * 7)));
    const baseDay = state.view === 'day' ? startOfDay(state.anchor) : days[dayIdx];
    return new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), hour, 0, 0);
  }

  // ---- Toolbar Actions ----
  root.querySelector('.sfc-view').addEventListener('change', (e) => {
    state.view = e.target.value;
    render();
  });  
  root.querySelector('.sfc-view').value = state.view;

  root.querySelector('[data-nav="prev"]').addEventListener('click', () => {
    if (state.view === 'year') state.anchor.setFullYear(state.anchor.getFullYear() - 1);
    else if (state.view === 'month') state.anchor.setMonth(state.anchor.getMonth() - 1);
    else if (state.view === 'week') state.anchor = addDays(state.anchor, -7);
    else state.anchor = addDays(state.anchor, -1);
    render();
  });

  root.querySelector('[data-nav="next"]').addEventListener('click', () => {
    if (state.view === 'year') state.anchor.setFullYear(state.anchor.getFullYear() + 1);
    else if (state.view === 'month') state.anchor.setMonth(state.anchor.getMonth() + 1);
    else if (state.view === 'week') state.anchor = addDays(state.anchor, 7);
    else state.anchor = addDays(state.anchor, 1);
    render();
  });

  root.querySelector('[data-nav="today"]').addEventListener('click', () => {
    state.anchor = new Date();
    render();
  });

  root.querySelector('[data-action="export"]').addEventListener('click', exportICS);

  root.querySelector('[data-action="import-text"]').addEventListener('click', () => {
    const txt = prompt('Paste ICS text');
    if (txt) importICS(txt, `Text ${state.sources.length + 1}`);
  });

  root.querySelector('[data-action="import-file"]').addEventListener('click', async () => {
    const inp = root.querySelector('.sfc-file');
    if (!inp.files || !inp.files[0]) return;
    const text = await inp.files[0].text();
    importICS(text, inp.files[0].name);
    inp.value = '';
  });

  root.querySelector('[data-action="import-url"]').addEventListener('click', async () => {
    const url = root.querySelector('.sfc-url').value.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      const text = await res.text();
      importICS(text, url);
    } catch (e) {
      alert('Failed to fetch ICS URL');
    }
  });

  // Modal actions
  root.querySelector('[data-action="save"]').addEventListener('click', saveEditor);
  root.querySelector('[data-action="delete"]').addEventListener('click', deleteEditor);
  root.querySelector('[data-action="cancel"]').addEventListener('click', closeEditor);

  // Initial render
  render();

  // ---- Public API (optional) ----
  return {
    importICS,
    exportICS,
    addEvent: (ev) => {
      ev.uid = ev.uid || uuid();
      ev.sourceId = ev.sourceId || (state.sources[0]?.id || 'local');
      state.events.push(ev);
      render();
    },
    setView: (v) => {
      state.view = v;
      render();
    },
    goto: (date) => {
      state.anchor = new Date(date);
      render();
    },
  };
}
SingleCalendar(document.getElementById('app'))
</script>
