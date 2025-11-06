
  /*
    createScoreboard(container, options)
    - container: DOM element or selector string
    - options: optional presets for game, teams, players, rules
    - Notes: In-page Setup editor (expand/collapse), drag-drop reordering for periods & players,
             per-player live stat cards in the scoreboard view.
  */
  function createScoreboard(container, options = {}) {
    // --- DOM helpers
    const el = (tag, attrs = {}, txt = "") => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === "class") e.className = v;
        else if (k === "html") e.innerHTML = v;
        else e.setAttribute(k, v);
      }
      if (txt) e.textContent = txt;
      return e;
    };
    const q = s => document.querySelector(s);
    const qa = s => Array.from(document.querySelectorAll(s));
    const root = typeof container === "string" ? document.querySelector(container) : container;
    if (!root) throw new Error("Container not found");

    // --- Inject CSS (mobile-first)
    const css = `
:root{--accent:#66c;--danger:#c33;--muted:#666,--bg:#333;--fg:#ccc;}
.sb-wrap *,.sb-wrap *::before,.sb-wrap *::after{box-sizing: inherit;}
.sb-wrap{box-sizing: border-box;}
.sb-wrap{background:var(--bg);color:#ccc;max-width:1100px;margin:8px auto;padding:8px}
.sb-top{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.sb-scoreboard{padding:10px;border-radius:8px;border:1px solid var(--accent)}
.sb-row{display:grid;grid-template-columns:2fr 1fr 2fr;align-items:center;gap:6px}
.sb-stat{font-weight:700;font-size:1.6rem}
.sb-direction{text-align:center}
.sb-controls{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.sb-button{  width: 100%;  margin: 3px 0;background:var(--accent);border:none;color:#fff;padding:8px 10px;border-radius:6px;font-size:0.9rem;cursor:pointer}
.sb-button.ghost{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.sb-button.warn{background:var(--danger)}
.sb-button.small{padding:6px 8px;font-size:.85rem}
.sb-dynamic{margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sb-log{background:#444;padding:8px;border-radius:6px;border:1px solid var(--accent);max-height:320px;overflow:auto}
.sb-log-entry{padding:6px;border-bottom:1px dashed var(--accent);display:flex;justify-content:space-between;gap:8px}
.sb-log-meta{font-size:0.85rem;color:var(--muted)}
.sb-toast{z-index:999;position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#222;color:#fff;padding:10px 14px;border-radius:6px;opacity:0;pointer-events:none;transition:.2s}
.sb-toast.show{opacity:1;pointer-events:auto}
.sb-modal-backdrop{position:fixed;left:0;top:0;right:0;bottom:0;background:#222c;display:flex;align-items:center;justify-content:center;z-index:9999}
.sb-modal{  border: 1px solid var(--accent);background:#222;padding:14px;border-radius:8px;max-width:720px;width:94%;max-height:85vh;overflow:auto}
.sb-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sb-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.sb-input{background: var(--bg);  color: var(--fg);width:100%;padding:8px;border-radius:6px;border:1px solid var(--accent)}
.sb-small{text-transform:uppercase;font-size:0.75rem;color:var(--muted)}
.sb-flash{animation:sbflash .5s ease}
.sb-period-list{border:1px solid var(--accent);padding:8px;border-radius:6px;max-height:220px;overflow:auto;background:var(--bg)}
.sb-period-item{display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px dashed var(--accent)}
.sb-official-list{border:1px solid var(--accent);padding:8px;border-radius:6px;max-height:160px;overflow:auto;background:var(--bg);margin-top:8px}
.sb-official-item{display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px dashed var(--accent)}
.sb-player-list{border:1px solid var(--accent);padding:8px;border-radius:6px;max-height:240px;overflow:auto;background:var(--bg);margin-top:8px}
.sb-player-item{display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px dashed var(--accent)}
.sb-setup-panel{margin-top:12px;border:1px solid var(--accent);padding:12px;border-radius:8px;background:#222}
.sb-setup-toggle{margin-left:8px}
.sb-player-cards{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sb-player-card{border:1px solid var(--accent);padding:8px;border-radius:8px;min-width:160px;background:#222;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.sb-player-card h4{margin:0 0 6px 0;font-size:0.95rem}
.sb-controls .sb-button.small{width:auto;margin:0}
@keyframes sbflash{0%{background:rgba(255,255,0,.95)}100%{background:transparent}}
@media (max-width:900px){
  .sb-row{grid-template-columns:1fr 1fr 1fr}
  .sb-dynamic{grid-template-columns:1fr}
  .sb-player-cards{justify-content:center}
}
@media print{
  .sb-controls, .sb-toast, .sb-modal-backdrop { display:none !important }
  body * { visibility: hidden } .sb-wrap, .sb-wrap * { visibility: visible } .sb-wrap { position: absolute; left:0; top:0; width:100% }
}
  select.sb-input {	background: #999;	color: #000;}
   .sb-right { text-align: right; }
`;
    const style = el("style", { html: css });
    document.head.appendChild(style);

    // --- Toast and modal utilities (modals return {promise, backdrop, modal, content})
    const toastEl = el("div", { class: "sb-toast", id: "sb-toast" });
    document.body.appendChild(toastEl);
    function showToast(msg, timeout = 2200) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.remove("show"), timeout);
    }

    function showModal({ title = "", html = "", okText = "OK", cancelText = "Cancel", showCancel = false }) {
      const backdrop = el("div", { class: "sb-modal-backdrop" });
      const modal = el("div", { class: "sb-modal" });
      if (title) modal.appendChild(el("h3", {}, title));
      const content = el("div", { html });
      modal.appendChild(content);
      const footer = el("div", { class: "sb-controls" });
      const ok = el("button", { class: "sb-button" }, okText);
      const cancel = el("button", { class: "sb-button ghost" }, cancelText);
      footer.appendChild(ok);
      if (showCancel) footer.appendChild(cancel);
      modal.appendChild(footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      const promise = new Promise(resolve => {
        ok.addEventListener("click", () => { document.body.removeChild(backdrop); resolve(true); });
        cancel.addEventListener("click", () => { document.body.removeChild(backdrop); resolve(false); });
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop && showCancel) { document.body.removeChild(backdrop); resolve(false); }
        });
      });

      return { promise, backdrop, modal, content };
    }

    // --- Default state (options injection)
const state = {};
function initState() {
    const nowISO = new Date().toISOString().slice(0, 10);
    const tempState= {
      periodTypes:options.periodTypes|| ["Setup", "Period", "Break","Overtime"],
      game: {
        Location: (options.game && options.game.Location) || "",
        League: (options.game && options.game.League) || "",
        Date: (options.game && options.game.Date) || nowISO,
        Time: (options.game && options.game.Time) || "",
        MatchNo: (options.game && options.game.MatchNo) || "",
        Periods: (options.game && options.game.Periods) || 4,
        PeriodsConfig: (options.game && options.game.PeriodsConfig) || [
          { type: "Setup", duration: 10 },
          { type: "Period", number: 1, duration: 10 },
          { type: "Break", number: 1, duration: 1 },
          { type: "Period", number: 2, duration: 10 },
          { type: "Break", number: 2, duration: 5 },
          { type: "Period", number: 3, duration: 10 },
          { type: "Break", number: 3, duration: 1 },
          { type: "Period", number: 4, duration: 10 },
          { type: "Break", number: 4, duration: 1 },
          { type: "Period", number: 5, duration: 5 },
          { type: "Break", number: 5, duration: 1 },
          { type: "Period", number: 6, duration: 5 },
          { type: "Break", number: 6, duration: 1 },
          { type: "Period", number: 7, duration: 5 },
          { type: "Break", number: 7, duration: 1 },
          { type: "Period", number: 8, duration: 5 }
        ],
        ShotClock: (options.game && options.game.ShotClock) || 24,
        Arrow: (options.game && options.game.Arrow) || "",
        Officials: (options.game && options.game.Officials) || [],
        Clock: { elapsed: 0, paused: 1, countDownDate: 0, timerTime: 600000, PeriodIndex: 0 }
      },
      teams: {
        Home: {
          Name: (options.teams && options.teams.Home && options.teams.Home.Name) || "Home",
          Colour: (options.teams && options.teams.Home && options.teams.Home.Colour) || "#0b79d0",
          TimeOuts: (options.teams && options.teams.Home && options.teams.Home.TimeOuts) || 0,
          Players: (options.teams && options.teams.Home && options.teams.Home.Players) || [{ Name: "Misc", LicenceNo: "", KitNumber: -1, Points: [], Fouls: [] }]
        },
        Away: {
          Name: (options.teams && options.teams.Away && options.teams.Away.Name) || "Away",
          Colour: (options.teams && options.teams.Away && options.teams.Away.Colour) || "#d9534f",
          TimeOuts: (options.teams && options.teams.Away && options.teams.Away.TimeOuts) || 0,
          Players: (options.teams && options.teams.Away && options.teams.Away.Players) || [{ Name: "Misc", LicenceNo: "", KitNumber: -1, Points: [], Fouls: [] }]
        }
      },
      rules: Object.assign({ maxFoulsPerPlayer: 5, maxTeamFoulsPerPeriod: 4 }, options.rules || {}),
      log: []
    };
        Object.assign(state, tempState);
  }initState();
    // player maps and history stacks
    function rebuildPlayerMaps() {
      state.teams.Home.PlayerMap = Object.fromEntries(state.teams.Home.Players.map(p => [String(p.KitNumber), p]));
      state.teams.Away.PlayerMap = Object.fromEntries(state.teams.Away.Players.map(p => [String(p.KitNumber), p]));
    }
    rebuildPlayerMaps();

    const history = [], future = [];
    function pushHistory() { history.push(JSON.stringify(state)); if (history.length > 300) history.shift(); future.length = 0; }
    function undo() { if (!history.length) return showToast("Nothing to undo"); future.push(JSON.stringify(state)); const prev = JSON.parse(history.pop()); Object.assign(state, prev); rebuildPlayerMaps(); renderAll(); showToast("Undo"); }
    function redo() { if (!future.length) return showToast("Nothing to redo"); history.push(JSON.stringify(state)); const next = JSON.parse(future.pop()); Object.assign(state, next); rebuildPlayerMaps(); renderAll(); showToast("Redo"); }
    function clearResults() {
      clock.dispose(); 
      state.game.Clock = {}; 
      state.clock = {};
      state.log = []; 
      pushHistory(); 
      rebuildPlayerMaps(); 
      renderAll(); 
      renderTime(clock.current()?.duration * 60 * 1000 || 0);
      showToast("cleared");
    }
    function clearGame() {
      //initState();
      state.game = {};
      state.teams = {};
      state.log = [];
      state.clock = {};
      initState();
      clock.dispose(); 
      clock.setIndex(0); 
      pushHistory(); 
      rebuildPlayerMaps(); 
      renderAll(); 
      renderTime(clock.current()?.duration * 60 * 1000 || 0);
      showToast("cleared");
      //showToast("Removed saved state; reloading");
      //setTimeout(() => window.location.reload(), 250);
    }

    // events
    const events = { onScore: [], onFoul: [], onPeriodChange: [], onTimeout: [] };
    function trigger(ev, p) { events[ev]?.forEach(fn => { try { fn(p); } catch (e) { console.error(e); } }); }

    // --- Clock class
    class GameClock {
      constructor(periodsConfig) {
        this.periods = periodsConfig || state.game.PeriodsConfig;
        this.index = state.game.Clock.PeriodIndex || 0;
        this.timer = null;
        this.paused = state.game.Clock.paused === 1;
        this.elapsed = state.game.Clock.elapsed || 0;
        this.timerTime = (this.current()?.duration || 10) * 60 * 1000;
        this.countDownDate = state.game.Clock.countDownDate || 0;
        this.dir = 0;
        this.loop = 250;
      }
      current() { return this.periods[this.index] || null; }
      isActivePeriod() { return this.current() && this.current().type === "Period" && !this.paused; }
      start() {
        if (this.timer) clearInterval(this.timer);
        this.timerTime = (this.current()?.duration || 10) * 60 * 1000;
        const startTime = Date.now() - this.elapsed;
        this.countDownDate = startTime + this.timerTime;
        this.paused = false; 
        state.game.Clock.paused = 0;
        state.game.Clock.countDownDate = this.countDownDate; 
        state.game.Clock.timerTime = this.timerTime;
        pushHistory();
        this.timer = setInterval(() => {
          const now = Date.now();
          let distance = this.countDownDate - now;
          this.elapsed = this.timerTime - distance;
          if (this.dir === 1) distance = this.elapsed;
          renderTime(Math.max(distance, 0));
          if (distance <= 0 && !this.paused) {
            clearInterval(this.timer);
            this.paused = true; 
            state.game.Clock.paused = 1; 
            state.game.Clock.elapsed = 0;
            this.advance();
          } else {
            state.game.Clock.elapsed = this.elapsed; 
            state.game.Clock.countDownDate = this.countDownDate; 
            state.game.Clock.timerTime = this.timerTime;
            try { localStorage.setItem("scoreboard_state", JSON.stringify(state)); } catch (e) { }
          }
        }, this.loop);
      }
      stop() {
        if (this.timer) clearInterval(this.timer); 
        this.timer = null; 
        this.paused = true;
        state.game.Clock.paused = 1; 
        state.game.Clock.elapsed = this.elapsed;
        pushHistory();
      }
      updatePeriods(p) {
        this.periods = p;
        this.timerTime = (this.current()?.duration || 10) * 60 * 1000;
        this.countDownDate = state.game.Clock.countDownDate || 0;
        pushHistory();
      }
      advance() {
        clock.stop();
        if (this.index < this.periods.length - 1) {
          this.index += 1;
          state.game.Clock.PeriodIndex = this.index;
          state.game.Clock.elapsed = 0; this.elapsed = 0;
          state.game.Clock.paused = 1; this.paused = 1;
          this.timerTime = (this.current()?.duration || 0) * 60 * 1000;
          const entry = { id: genId(), ts: Date.now(), type: "PeriodChange", payload: { index: this.index, period: this.current() }, undone: false };
          state.log.push(entry);
          renderTime(this.timerTime);
          pushHistory();
          trigger("onPeriodChange", entry);
          renderAll();
          showToast("Period advanced");
          //if (this.current()?.type === "Period") setTimeout(() => this.start(), 1200);
        } else {
          showToast("Already at final period");
        }
      }
      setIndex(i) { if (i >= 0 && i < this.periods.length) { this.index = i; state.game.Clock.PeriodIndex = i; this.timerTime = (this.current()?.duration || 0) * 60 * 1000; pushHistory(); renderAll(); } }
      setDir(d) { this.dir = d ? 1 : 0; }
      dispose() { if (this.timer) clearInterval(this.timer); }
    }

    // restore persisted
    try {
      const persisted = JSON.parse(localStorage.getItem("scoreboard_state") || "null");
      if (persisted) {
        Object.assign(state, persisted);
        rebuildPlayerMaps();
        //clock.index = state.game.Clock.PeriodIndex || clock.index;
        //clock.elapsed = state.game.Clock.elapsed || 0;
        //clock.timerTime = state.game.Clock.timerTime || clock.timerTime;
      }
    } catch (e) { }
    const clock = new GameClock(state.game.PeriodsConfig);

    // --- Utilities
    function genId() { return "e" + Math.random().toString(36).slice(2, 9); }
    function msToTime(ms) { ms = Math.max(0, Math.floor(ms)); const s = Math.floor(ms / 1000); const mm = Math.floor(s / 60); const ss = s % 60; return `${String(mm).padStart(2, "0")}m${String(ss).padStart(2, "0")}s`; }
    function computeScore(team) { return state.log.filter(l => !l.undone && l.type === "Point" && l.team === team).reduce((s, l) => s + (l.payload.Number || 0), 0); }
    function computeFouls(team, periodIndex) { return state.log.filter(l => !l.undone && l.type === "Foul" && l.team === team && (periodIndex === undefined || l.payload.periodIndex === periodIndex)).length; }
    function computeTimeouts(team, periodIndex) { return state.log.filter(l => !l.undone && l.type === "Timeout" && l.team === team && (periodIndex === undefined || (periodIndexMatchesHalf(l.payload.periodIndex,periodIndex)))).length; }

    function periodIndexMatchesHalf(periodIndex, index) {
      const half = index < 3 ? 1 : 2;
      if (half === 1) return periodIndex === 0 || periodIndex === 1;
      if (half === 2) return periodIndex === 2 || periodIndex === 3;
      return false;
    }
    
    function computePlayerStats(team, kit) {
      const points = state.log.filter(l => !l.undone && l.type === "Point" && l.team === team && String(l.kit) === String(kit)).reduce((s, l) => s + (l.payload.Number || 0), 0);
      const fouls = state.log.filter(l => !l.undone && l.type === "Foul" && l.team === team && String(l.kit) === String(kit)).length;
      return { points, fouls };
    }

    function exportJSON() { return JSON.stringify(state, null, 2); }
    function exportCSV() {
      const rows = [["id", "timestamp", "type", "team", "kit", "payload", "undone"]];
      state.log.forEach(l => rows.push([l.id, new Date(l.ts).toISOString(), l.type, l.team || "", l.kit !== undefined ? l.kit : "", JSON.stringify(l.payload || {}).replace(/"/g, '""'), l.undone ? "1" : "0"]));
      return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    }
    function exportImageDataURL() {
      const c = document.createElement("canvas"); const w = 1000, h = 700; c.width = w; c.height = h; const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#111"; ctx.font = "24px sans-serif";
      ctx.fillText(`${state.teams.Home.Name} ${computeScore("Home")} - ${computeScore("Away")} ${state.teams.Away.Name}`, 20, 40);
      ctx.font = "14px sans-serif"; ctx.fillText(`Period: ${getPeriodLabel()}`, 20, 70); ctx.fillText(`Time: ${q("#sb-time").textContent}`, 20, 92);
      const recent = state.log.slice(-18).reverse();
      ctx.font = "12px monospace";
      recent.forEach((l, idx) => { ctx.fillStyle = l.undone ? "#bbb" : "#222"; const t = `${new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${l.type} ${l.team ? l.team + ":" : ""}${l.kit !== undefined ? l.kit : ""} ${l.payload && (l.payload.Number || l.payload.Type) ? (l.payload.Number || l.payload.Type) : ""}`; ctx.fillText(t, 20, 130 + idx * 16); });
      return c.toDataURL("image/png");
    }

    // --- Log operations
    function logEvent(evt) {
      const entry = Object.assign({ id: genId(), ts: Date.now(), undone: false }, evt);
      state.log.push(entry);
      pushHistory();
      rebuildPlayerMaps();
      if (entry.type === "Point") trigger("onScore", entry);
      if (entry.type === "Foul") trigger("onFoul", entry);
      if (entry.type === "Timeout") trigger("onTimeout", entry);
      renderAll();
      try { localStorage.setItem("scoreboard_state", JSON.stringify(state)); } catch (e) { }
    }
    function softDeleteLog(id) { const it = state.log.find(l => l.id === id); if (!it) return showToast("Not found"); it.undone = true; pushHistory(); rebuildPlayerMaps(); renderAll(); showToast("Removed from live view"); }
    function restoreLog(id) { const it = state.log.find(l => l.id === id); if (!it) return showToast("Not found"); it.undone = false; pushHistory(); renderAll(); showToast("Restored"); }
    function hardDeleteLog(id) { state.log = state.log.filter(l => l.id !== id); pushHistory(); renderAll(); showToast("Deleted"); }

    // --- UI build
    root.innerHTML = "";
    const wrap = el("div", { class: "sb-wrap" });
    root.appendChild(wrap);

    // Top
    const top = el("div", { class: "sb-top" });
    top.appendChild(el("div", { html: `<div class="sb-small">Match</div><div><strong id="sb-title">${state.game.League || ""} ${state.game.MatchNo || ""}</strong></div>` }));
    const topControls = el("div", { class: "sb-controls" });
    function addTopBtn(txt, cls, fn) { const b = el("button", { class: cls || "sb-button small" }, txt); b.addEventListener("click", fn); topControls.appendChild(b); return b; }
    addTopBtn("Undo", "sb-button small ghost", undo);
    addTopBtn("Redo", "sb-button small ghost", redo);
    addTopBtn("Clear", "sb-button small ghost", clearResults);
    addTopBtn("Clear All", "sb-button small ghost", clearGame);
    addTopBtn("Export JSON", "sb-button small", () => download("game.json", exportJSON()));
    addTopBtn("Export CSV", "sb-button small", () => download("game.csv", exportCSV()));
    addTopBtn("Export Image", "sb-button small", () => downloadDataUrl(exportImageDataURL(), "scoreboard.png"));
    addTopBtn("Print", "sb-button small ghost", () => printScore());
    // Setup toggle now opens inline panel (expand/collapse)
    const setupToggle = addTopBtn("Setup", "sb-button small", () => { toggleSetupPanel(); });
    setupToggle.classList.add("sb-setup-toggle");
    top.appendChild(topControls);
    wrap.appendChild(top);

    // Scoreboard main
    const board = el("div", { class: "sb-scoreboard", id: "sb-scoreboard" });
    board.appendChild(el("div", { class: "sb-row", html: `<div class="label" id="label-home">${state.teams.Home.Name}</div><div class="label" style="text-align:center">Score</div><div class="label sb-right" id="label-away">${state.teams.Away.Name}</div>` }));
    board.appendChild(el("div", { class: "sb-row", html: `<div class="sb-stat" id="sb-home">${computeScore("Home")}</div><div class="label" style="text-align:center">Live</div><div class="sb-stat sb-right" id="sb-away">${computeScore("Away")}</div>` }));
    board.appendChild(el("hr"));
    board.appendChild(el("div", { class: "sb-row", html: `<div class="sb-direction" id="sb-arrow-left">${state.game.Arrow === "left" ? "<<=" : "-"}</div><div class="label" style="text-align:center">Arrow</div><div class="sb-direction" id="sb-arrow-right">${state.game.Arrow === "right" ? "=>>" : "-"}</div>` }));


    board.appendChild(el("hr"));
    board.appendChild(el("div", { class: "sb-row", html: `<div class="sb-stat" id="sb-home-fouls">${computeFouls("Home", state.game.Clock.PeriodIndex || clock.index)}</div><div class="label" style="text-align:center">Fouls</div><div class="sb-stat sb-right" id="sb-away-fouls">${computeFouls("Away", state.game.Clock.PeriodIndex || clock.index)}</div>` }));
    board.appendChild(el("hr"));
    board.appendChild(el("div", { class: "sb-row", html: `<div class="sb-stat" id="sb-home-timeouts">${computeTimeouts("Home", state.game.Clock.PeriodIndex || clock.index)}</div><div class="label" style="text-align:center">Timeouts</div><div class="sb-stat sb-right" id="sb-away-timeouts">${computeTimeouts("Away", state.game.Clock.PeriodIndex || clock.index)}</div>` }));
    board.appendChild(el("hr"));
    const periodRow = el("div", { class: "sb-row" });
    periodRow.appendChild(el("div", { class: "label", html: `Period <div class="sb-small" id="sb-period">${getPeriodLabel()}</div>` }));
    periodRow.appendChild(el("div", { class: "label", html: `Time <div id="sb-time" class="sb-stat">${msToTime(state.game.Clock.elapsed > 0 ? state.game.Clock.timerTime - state.game.Clock.elapsed:clock.current()?.duration * 60 * 1000 || 0)}</div>` }));
    board.appendChild(periodRow);

    // player cards area (per-player live stat cards)
    const playerCardsArea = el("div", { id: "sb-player-cards" });
    board.appendChild(playerCardsArea);

    wrap.appendChild(board);
    // arrow click handlers (select direction)
    const sbArrowLeft = q("#sb-arrow-left");
    const sbArrowRight = q("#sb-arrow-right");
    if (sbArrowLeft) {
      sbArrowLeft.style.cursor = "pointer";
      sbArrowLeft.addEventListener("click", () => {
        state.game.Arrow = state.game.Arrow === "left" ? "" : "left";
        pushHistory();
        renderAll();
        showToast(`Arrow set to ${state.game.Arrow || "none"}`);
      });
    }
    if (sbArrowRight) {
      sbArrowRight.style.cursor = "pointer";
      sbArrowRight.addEventListener("click", () => {
        state.game.Arrow = state.game.Arrow === "right" ? "" : "right";
        pushHistory();
        renderAll();
        showToast(`Arrow set to ${state.game.Arrow || "none"}`);
      });
    }
    // Controls and log
    const dynamic = el("div", { class: "sb-dynamic" });
    const actionsPanel = el("div");
    actionsPanel.appendChild(el("div", { class: "sb-small", html: "Actions" }));
    const actionGrid = el("div", { class: "sb-grid-2" });
    [3, 2, 1, -1, -2, -3].forEach(p => {
      const b = el("button", { class: "sb-button small" }, String(p));
      b.addEventListener("click", () => openPlayerSelectModal({ type: "Point", Number: p }));
      actionGrid.appendChild(b);
    });
    ["Personal", "Technical", "Unsportsman"].forEach(f => {
      const b = el("button", { class: "sb-button small ghost" }, f);
      b.addEventListener("click", () => openPlayerSelectModal({ type: "Foul", Type: f }));
      actionGrid.appendChild(b);
    });
    const timeoutBtn = el("button", { class: "sb-button small" }, "Timeout");
    timeoutBtn.addEventListener("click", () => openTimeoutModal());
    actionGrid.appendChild(timeoutBtn);

    // clock controls
    const startBtn = el("button", { class: "sb-button small sb-btn-clock-start" }, "Start");
    startBtn.addEventListener("click", () => { clock.start(); renderAll(); showToast("Clock started"); });
    const stopBtn = el("button", { class: "sb-button small ghost" }, "Stop");
    stopBtn.addEventListener("click", () => { clock.stop(); renderAll(); showToast("Clock stopped"); });
    const advBtn = el("button", { class: "sb-button small" }, "Advance Period");
    advBtn.addEventListener("click", () => { if (!isPeriod()) { clock.advance(); renderAll(); } });
    actionGrid.appendChild(startBtn); actionGrid.appendChild(stopBtn); actionGrid.appendChild(advBtn);

    actionsPanel.appendChild(actionGrid);
    dynamic.appendChild(actionsPanel);

    const logPanel = el("div");
    logPanel.appendChild(el("div", { class: "sb-small", html: "Event Log" }));
    const logList = el("div", { class: "sb-log", id: "sb-log" });
    logPanel.appendChild(logList);
    dynamic.appendChild(logPanel);
    wrap.appendChild(dynamic);

    // Setup inline panel (collapsible)
    const setupPanel = el("div", { class: "sb-setup-panel", id: "sb-setup-panel", style: "display:none" });
    // We'll populate the content when toggled open so it always queries current state.
    wrap.appendChild(setupPanel);

    // helpers for UI rendering
    function isPeriod() {
      return isPeriodType("Period");
    }
    function isPeriodType(type) {
      const idx = state.game.Clock.PeriodIndex || clock.index;
      const p = state.game.PeriodsConfig[idx] || {};
      return p.type === type;
    }
    function getPeriodLabel() {
      const idx = state.game.Clock.PeriodIndex || clock.index;
      const p = state.game.PeriodsConfig[idx] || {};
      if (p.type === "Period") return p.number || idx;
      return p.type + (('number' in p)?" " + p.number:"")|| "Unknown";
    }
    function renderTime(ms) { const tEl = q("#sb-time"); if (tEl) tEl.textContent = msToTime(ms); }
    function renderPlayerCards() {
      const container = q("#sb-player-cards");
      if (!container) return;
      container.innerHTML = "";
      // Show Home players then Away players
      ["Home", "Away"].forEach(team => {
        const teamHeader = el("div", { html: `<div class="sb-small">${escapeHtml(state.teams[team].Name)} players</div>` });
        container.appendChild(teamHeader);
        const cards = el("div", { class: "sb-player-cards" });
        state.teams[team].Players.forEach(p => {
          const stats = computePlayerStats(team, p.KitNumber);
          const card = el("div", { class: "sb-player-card", "data-team": team, "data-kit": String(p.KitNumber) });
          card.appendChild(el("h4", {}, (p.KitNumber > -1 ? `#${p.KitNumber} ` : "") + p.Name));
          card.appendChild(el("div", { html: `<div>Points: <strong>${stats.points}</strong></div><div>Fouls: <strong>${stats.fouls}</strong></div>` }));
          // Quick action buttons on card
          const actions = el("div", { style: "margin-top:8px;display:flex;gap:6px" });
          const ptBtn = el("button", { class: "sb-button small" }, "+1");
          ptBtn.addEventListener("click", () => applyActionToPlayer({ team, kit: p.KitNumber, action: { type: "Point", Number: 1 } }));
          const foulBtn = el("button", { class: "sb-button small ghost" }, "Foul");
          foulBtn.addEventListener("click", () => applyActionToPlayer({ team, kit: p.KitNumber, action: { type: "Foul", Type: "Personal" } }));
          actions.appendChild(ptBtn); actions.appendChild(foulBtn);
          card.appendChild(actions);
          cards.appendChild(card);
        });
        container.appendChild(cards);
      });
    }
    function renderAll() {
      const homeEl = q("#sb-home"); if (homeEl) homeEl.textContent = computeScore("Home");
      const awayEl = q("#sb-away"); if (awayEl) awayEl.textContent = computeScore("Away");
      const hf = q("#sb-home-fouls"); if (hf) hf.textContent = computeFouls("Home", state.game.Clock.PeriodIndex || clock.index);
      const af = q("#sb-away-fouls"); if (af) af.textContent = computeFouls("Away", state.game.Clock.PeriodIndex || clock.index);
      const ht = q("#sb-home-timeouts"); if (ht) ht.textContent = computeTimeouts("Home", state.game.Clock.PeriodIndex || clock.index);
      const at = q("#sb-away-timeouts"); if (at) at.textContent = computeTimeouts("Away", state.game.Clock.PeriodIndex || clock.index);
      const sp = q("#sb-period"); if (sp) sp.textContent = getPeriodLabel();
      const st = q("#sb-title"); if (st) st.textContent = `${state.game.League || ""} ${state.game.MatchNo || ""}`.trim();
      const leftArrow = q("#sb-arrow-left");
      if (leftArrow) {
        leftArrow.textContent = state.game.Arrow === "left" ? "<<=" : "-";
      }
      const rightArrow = q("#sb-arrow-right");
      if (rightArrow) {
        rightArrow.textContent = state.game.Arrow === "right" ? "=>>" : "-";
      }
      const homeLabel = q("#label-home"); if (homeLabel) homeLabel.textContent = state.teams.Home.Name;
      const awayLabel = q("#label-away"); if (awayLabel) awayLabel.textContent = state.teams.Away.Name;
      //const timeLabel = q("#sb-time"); if (timeLabel) timeLabel.textContent = msToTime(state.game.PeriodsConfig[state.game.Clock.PeriodIndex].duration *60*1000);

      // render log
      logList.innerHTML = "";
      state.log.slice().reverse().forEach(l => {
        const entry = el("div", { class: "sb-log-entry" });
        const left = el("div", {
          html: `<div><strong>${l.type}</strong> <span class="sb-log-meta">${new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="sb-log-meta">${l.team ? l.team : ""} ${l.kit !== undefined ? ("#" + l.kit) : ""} ${l.payload && (l.payload.Number || l.payload.Type) ? (l.payload.Number || l.payload.Type) : ""}</div>`
        });
        const right = el("div");
        const undoBtn = el("button", { class: "sb-button small ghost" }, l.undone ? "Restore" : "Undo");
        undoBtn.addEventListener("click", () => { if (l.undone) restoreLog(l.id); else softDeleteLog(l.id); });
        const detailsBtn = el("button", { class: "sb-button small" }, "Details");
        detailsBtn.addEventListener("click", () => showModal({ title: "Event details", html: `<pre>${escapeHtml(JSON.stringify(l, null, 2))}</pre>`, okText: "Close" }).promise);
        const delBtn = el("button", { class: "sb-button small warn" }, "Delete");
        delBtn.addEventListener("click", async () => {
          const m = showModal({ title: "Confirm delete", html: "<div>Delete permanently?</div>", okText: "Delete", showCancel: true });
          const ok = await m.promise;
          if (ok) hardDeleteLog(l.id);
        });
        right.appendChild(undoBtn); right.appendChild(detailsBtn); right.appendChild(delBtn);
        entry.appendChild(left); entry.appendChild(right);
        if (l.undone) entry.style.opacity = ".45";
        logList.appendChild(entry);
      });

      // flash
      ["#sb-home", "#sb-away"].forEach(id => {
        const e = q(id);
        if (!e) return;
        e.classList.add("sb-flash");
        setTimeout(() => e.classList.remove("sb-flash"), 450);
      });

      // disable Advance Period while active period is running
      const advButtons = qa("button").filter(b => b.textContent.trim() === "Advance Period");
      advButtons.forEach(b => {
        const isActive = clock.current() && clock.current().type === "Period" && clock.paused === false;
        b.disabled = isActive;
        b.style.opacity = isActive ? "0.5" : "1";
      });

      // render per-player cards
      renderPlayerCards();
    }

    // player selection modal (always has Any/Unknown)
    function openPlayerSelectModal(action) {
      const html = `<div class="sb-grid-2"><div>${escapeHtml(action.type === "Point" ? `Add ${action.Number} point(s)` : `Add ${action.Type} foul`)}</div></div>`;
      const m = showModal({ title: action.type === "Point" ? `Point ${action.Number}` : `Foul ${action.Type}`, html: html, okText: "Close" });
      const content = m.content;
      content.innerHTML = "";
      const row = el("div", { class: "sb-grid-2" });
      ["Home", "Away"].forEach(team => {
        const block = el("div");
        const t = el("div", {}, team);
        block.appendChild(t);
        const any = el("button", { class: "sb-button small ghost" }, "Any / Unknown Player");
        any.addEventListener("click", () => { applyActionToPlayer({ team, kit: -1, action }); document.body.removeChild(m.backdrop); });
        block.appendChild(any);
        state.teams[team].Players.forEach(p => {
          const label = p.KitNumber > -1 ? `#${p.KitNumber} ${p.Name}` : p.Name;
          const b = el("button", { class: "sb-button small", draggable: false }, label);
          b.addEventListener("click", () => { applyActionToPlayer({ team, kit: p.KitNumber, action }); document.body.removeChild(m.backdrop); });
          block.appendChild(b);
        });
        row.appendChild(block);
      });
      content.appendChild(row);
      return m.promise;
    }

    function applyActionToPlayer({ team, kit, action }) {
      if(isPeriodType("Setup")) {
        return showToast("Not allowed in setup");
      }
      const periodIndex = state.game.Clock.PeriodIndex || clock.index;
      if (action.type === "Point") {
        const entry = { type: "Point", team, kit, payload: { Number: action.Number, periodIndex }, ts: Date.now() };
        logEvent(entry);
      } else if (action.type === "Foul") {
        const entry = { type: "Foul", team, kit, payload: { Type: action.Type, periodIndex }, ts: Date.now() };
        logEvent(entry);
        const playerFouls = state.log.filter(l => !l.undone && l.type === "Foul" && l.team === team && String(l.kit) === String(kit)).length;
        const teamFouls = state.log.filter(l => !l.undone && l.type === "Foul" && l.team === team && l.payload && l.payload.periodIndex === periodIndex).length;
        if (playerFouls >= state.rules.maxFoulsPerPlayer) showToast(`Player #${kit} reached ${playerFouls} fouls`);
        if (teamFouls >= state.rules.maxTeamFoulsPerPeriod) showToast(`${team} has ${teamFouls} fouls this period`);
      }
      renderAll();
    }

    // Timeout modal with clickable team buttons
    function openTimeoutModal() {
      if (!isPeriod()) return;

      const html = `<div class="sb-grid-2">
      <button id="timeout-home" class="sb-button small">${escapeHtml(state.teams.Home.Name)}</button>
      <button id="timeout-away" class="sb-button small">${escapeHtml(state.teams.Away.Name)}</button>
    </div>`;
      const m = showModal({ title: "Start Timeout", html, okText: "Close" });
      const content = m.content;
      const homeBtn = content.querySelector("#timeout-home");
      const awayBtn = content.querySelector("#timeout-away");
      if (homeBtn) homeBtn.addEventListener("click", () => { applyTimeout("Home"); document.body.removeChild(m.backdrop); });
      if (awayBtn) awayBtn.addEventListener("click", () => { applyTimeout("Away"); document.body.removeChild(m.backdrop); });
      return m.promise;
    }

    function applyTimeout(team) {
      renderAll();
      clock.stop();
      const sbBtnClockStart = q(".sb-btn-clock-start");
      if (sbBtnClockStart) sbBtnClockStart.disabled = true;
      const entry = { type: "Timeout", team, payload: { durationMs: 60000,periodIndex: state.game.Clock.PeriodIndex || clock.index }, ts: Date.now() };
      logEvent(entry);
      trigger("onTimeout", entry);
      showToast(`${team} timeout started`);
      const timeoutEnd = Date.now() + 60000;
      const id = setInterval(() => {
        const rem = timeoutEnd - Date.now();
        const te = q("#sb-time");
        if (te) te.textContent = msToTime(rem);
        if (rem <= 0) { clearInterval(id); showToast("Timeout ended"); renderAll();if (sbBtnClockStart) sbBtnClockStart.disabled = false; 
      renderAll();
      renderTime(clock.current()?.duration * 60 * 1000 || 0);}
      }, 300);
    }

    // --- Setup inline panel (expand/collapse), build dynamic editing UI with drag-drop reordering
    let setupOpen = false;
    function toggleSetupPanel() {
      setupOpen = !setupOpen;
      const panel = q("#sb-setup-panel");
      if (!panel) return;
      if (!setupOpen) {
        panel.style.display = "none";
        return;
      }
      // show and populate
      panel.style.display = "block";
      panel.innerHTML = ""; // rebuild contents each time so we operate off fresh state copies

      // local editable copies to operate on; can reorder with drag-drop
      const periods = JSON.parse(JSON.stringify(state.game.PeriodsConfig || []));
      const officials = JSON.parse(JSON.stringify(state.game.Officials || []));
      const playersHome = JSON.parse(JSON.stringify(state.teams.Home.Players || []));
      const playersAway = JSON.parse(JSON.stringify(state.teams.Away.Players || []));

      // header inputs
      const header = el("div", { class: "sb-grid-2" });
      header.appendChild(el("div", { html: `<label class="sb-small">Home Name</label><input id="s-home-name" class="sb-input" value="${escapeHtml(state.teams.Home.Name)}" />` }));
      header.appendChild(el("div", { html: `<label class="sb-small">Away Name</label><input id="s-away-name" class="sb-input" value="${escapeHtml(state.teams.Away.Name)}" />` }));
      header.appendChild(el("div", { html: `<label class="sb-small">League</label><input id="s-league" class="sb-input" value="${escapeHtml(state.game.League)}" />` }));
      header.appendChild(el("div", { html: `<label class="sb-small">Match No</label><input id="s-matchno" class="sb-input" value="${escapeHtml(state.game.MatchNo)}" />` }));
      header.appendChild(el("div", { html: `<label class="sb-small">Arrow Direction</label><select id="s-arrow" class="sb-input"><option value="">None</option><option value="left"${state.game.Arrow === "left" ? " selected" : ""}>Left</option><option value="right"${state.game.Arrow === "right" ? " selected" : ""}>Right</option></select>` }));
      panel.appendChild(header);

      panel.appendChild(el("hr"));

      // Build grid: Periods (left), Officials (right)
      const grid = el("div", { class: "sb-dynamic" });

      // Periods editor -- form + list (drag-drop)
      const peWrap = el("div",{class:"sb-periods-editor-section"});
      if(state.game.Clock.countDownDate > 0 || state.game.Clock.periodIndex > 0){
        peWrap.style.opacity="0.5";
        peWrap.style.pointerEvents="none";
      }
      peWrap.appendChild(el("div", { class: "sb-small", html: "Periods Editor (drag to reorder)" }));
      const peForm = el("div", { class: "sb-grid-3", style: "margin-top:8px" });
      const selType = el("select", { class: "sb-input" });
      state.periodTypes.forEach(t => selType.appendChild(el("option", { value: t }, t)));
      const inNumber = el("input", { class: "sb-input", placeholder: "Number (Period only)", type: "number", min: "1" });
      const inDuration = el("input", { class: "sb-input", placeholder: "Duration (minutes)", type: "number", min: "0" });
      const peSubmit = el("button", { class: "sb-button small" }, "Add");
      peForm.appendChild(selType); peForm.appendChild(inNumber); peForm.appendChild(inDuration);
      peWrap.appendChild(peForm);
      peWrap.appendChild(el("div", { style: "margin-top:6px" }));
      const peSubmitWrap = el("div", { style: "display:flex;gap:8px;align-items:center" });
      peSubmitWrap.appendChild(peSubmit);
      peWrap.appendChild(peSubmitWrap);

      const peList = el("div", { class: "sb-period-list", id: "periods-dd-list", style: "margin-top:8px" });
      peWrap.appendChild(peList);

      // render periods list (supports drag)
      function renderPeriodsList() {
        peList.innerHTML = "";
        periods.forEach((p, idx) => {
          const row = el("div", { class: "sb-period-item", draggable: true, "data-idx": String(idx) });
          row.addEventListener("dragstart", ev => {
            ev.dataTransfer.setData("text/plain", String(idx));
            row.classList.add("dragging");
          });
          row.addEventListener("dragend", () => row.classList.remove("dragging"));
          row.addEventListener("dragover", ev => { ev.preventDefault(); row.style.background = "#eef"; });
          row.addEventListener("dragleave", () => { row.style.background = ""; });
          row.addEventListener("drop", ev => {
            ev.preventDefault();
            row.style.background = "";
            const from = Number(ev.dataTransfer.getData("text/plain"));
            const to = Number(row.getAttribute("data-idx"));
            if (isNaN(from) || isNaN(to) || from === to) return;
            const it = periods.splice(from, 1)[0];
            periods.splice(to, 0, it);
            renderPeriodsList();
          });
          const left = el("div", { html: `<div><strong>${escapeHtml(String(p.type))}${p.type === "Period" ? " " + escapeHtml(String(p.number || "")) : ""}</strong></div><div class="sb-log-meta">${escapeHtml(String(p.duration))} minute(s)</div>` });
          const right = el("div");
          const edit = el("button", { class: "sb-button small ghost" }, "Edit");
          const del = el("button", { class: "sb-button small warn" }, "Delete");
          edit.addEventListener("click", () => {
            selType.value = p.type; inNumber.value = p.number || ""; inDuration.value = p.duration || 0;
            peSubmit.textContent = "Update"; peSubmit._editing = idx;
          });
          del.addEventListener("click", async () => {
            const m = showModal({ title: "Delete Period", html: `<div>Delete ${escapeHtml(p.type)}${p.type === "Period" ? " " + escapeHtml(String(p.number)) : ""}?</div>`, okText: "Delete", showCancel: true });
            const ok = await m.promise;
            if (!ok) return;
            periods.splice(idx, 1); renderPeriodsList();
          });
          right.appendChild(edit); right.appendChild(del);
          row.appendChild(left); row.appendChild(right);
          peList.appendChild(row);
        });
      }
      renderPeriodsList();

      peSubmit.addEventListener("click", () => {
        const type = selType.value; const number = inNumber.value ? Number(inNumber.value) : undefined; const duration = inDuration.value ? Number(inDuration.value) : 0;
        if (!type) { showToast("Select period type"); return; }
        if (type === "Period" && (!number || number < 1)) { showToast("Enter period number"); return; }
        const item = type === "Period" ? { type, number, duration } : { type, duration };
        if (peSubmit._editing !== undefined) { periods[peSubmit._editing] = item; delete peSubmit._editing; peSubmit.textContent = "Add"; }
        else periods.push(item);
        inNumber.value = ""; inDuration.value = "";
        renderPeriodsList();
      });

      // Officials editor (form + list with edit/delete)
      const offWrap = el("div");
      offWrap.appendChild(el("div", { class: "sb-small", html: "Officials" }));
      const offForm = el("div", { class: "sb-grid-2", style: "margin-top:8px" });
      const offName = el("input", { class: "sb-input", placeholder: "Name" });
      const offLicence = el("input", { class: "sb-input", placeholder: "Licence No" });
      offForm.appendChild(offName); offForm.appendChild(offLicence);
      offWrap.appendChild(offForm);
      const offForm2 = el("div", { style: "margin-top:8px;display:flex;gap:8px;align-items:center" });
      const offPosition = el("input", { class: "sb-input", placeholder: "Position" });
      const offSubmit = el("button", { class: "sb-button small" }, "Add Official");
      offForm2.appendChild(offPosition); offForm2.appendChild(offSubmit);
      offWrap.appendChild(offForm2);
      const offList = el("div", { class: "sb-official-list", style: "margin-top:8px" });
      offWrap.appendChild(offList);

      function renderOfficialsList() {
        offList.innerHTML = "";
        officials.forEach((o, idx) => {
          const row = el("div", { class: "sb-official-item" });
          const left = el("div", { html: `<div><strong>${escapeHtml(o.Name || "")}</strong></div><div class="sb-log-meta">${escapeHtml(o.Position || "")} ${escapeHtml(o.LicenceNo || "")}</div>` });
          const right = el("div");
          const edit = el("button", { class: "sb-button small ghost" }, "Edit");
          const del = el("button", { class: "sb-button small warn" }, "Delete");
          edit.addEventListener("click", () => {
            offName.value = o.Name || ""; offLicence.value = o.LicenceNo || ""; offPosition.value = o.Position || "";
            offSubmit.textContent = "Update Official"; offSubmit._editing = idx;
          });
          del.addEventListener("click", async () => {
            const m = showModal({ title: "Delete Official", html: `<div>Delete ${escapeHtml(o.Name || "")}?</div>`, okText: "Delete", showCancel: true });
            const ok = await m.promise;
            if (!ok) return;
            officials.splice(idx, 1); renderOfficialsList();
          });
          right.appendChild(edit); right.appendChild(del);
          row.appendChild(left); row.appendChild(right);
          offList.appendChild(row);
        });
      }
      renderOfficialsList();

      offSubmit.addEventListener("click", () => {
        const Name = offName.value.trim(); const LicenceNo = offLicence.value.trim(); const Position = offPosition.value.trim();
        if (!Name) { showToast("Official must have a name"); return; }
        const item = { Name, LicenceNo, Position };
        if (offSubmit._editing !== undefined) { officials[offSubmit._editing] = item; delete offSubmit._editing; offSubmit.textContent = "Add Official"; }
        else officials.push(item);
        offName.value = ""; offLicence.value = ""; offPosition.value = "";
        renderOfficialsList();
      });

      grid.appendChild(peWrap);
      grid.appendChild(offWrap);
      panel.appendChild(grid);

      panel.appendChild(el("hr"));

      // Players editors with drag-drop
      const playersWrap = el("div");
      playersWrap.appendChild(el("div", { class: "sb-small", html: "Players (drag to reorder)" }));
      playersWrap.appendChild(el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px" }));

      // builder for player editors
      function buildPlayerEditorPanel(title, playersArr) {
        const rootNode = el("div");
        rootNode.appendChild(el("div", { class: "sb-small", html: title }));

        const form = el("div", { class: "sb-grid-3", style: "margin-top:8px" });
        const kitIn = el("input", { class: "sb-input", placeholder: "Kit Number", type: "number" });
        const nameIn = el("input", { class: "sb-input", placeholder: "Name" });
        const licIn = el("input", { class: "sb-input", placeholder: "Licence No" });
        const submitBtn = el("button", { class: "sb-button small" }, "Add Player");
        form.appendChild(kitIn); form.appendChild(nameIn); form.appendChild(licIn);
        rootNode.appendChild(form);
        rootNode.appendChild(el("div", { style: "margin-top:6px" }));
        rootNode.appendChild(submitBtn);

        const list = el("div", { class: "sb-player-list", style: "margin-top:8px" });
        rootNode.appendChild(list);

        function renderList() {
          list.innerHTML = "";
          playersArr.forEach((p, idx) => {
            const row = el("div", { class: "sb-player-item", draggable: true, "data-idx": String(idx) });
            row.addEventListener("dragstart", ev => { ev.dataTransfer.setData("text/plain", String(idx)); row.classList.add("dragging"); });
            row.addEventListener("dragend", () => row.classList.remove("dragging"));
            row.addEventListener("dragover", ev => { ev.preventDefault(); row.style.background = "#eef"; });
            row.addEventListener("dragleave", () => { row.style.background = ""; });
            row.addEventListener("drop", ev => {
              ev.preventDefault();
              row.style.background = "";
              const from = Number(ev.dataTransfer.getData("text/plain"));
              const to = Number(row.getAttribute("data-idx"));
              if (isNaN(from) || isNaN(to) || from === to) return;
              const it = playersArr.splice(from, 1)[0];
              playersArr.splice(to, 0, it);
              renderList();
            });

            const left = el("div", { html: `<div><strong>${p.KitNumber > -1 ? "#" + escapeHtml(String(p.KitNumber)) + " " + escapeHtml(p.Name) : escapeHtml(p.Name)}</strong></div><div class="sb-log-meta">Licence: ${escapeHtml(p.LicenceNo || "")}</div>` });
            const right = el("div");
            const edit = el("button", { class: "sb-button small ghost" }, "Edit");
            const del = el("button", { class: "sb-button small warn" }, "Delete");
            edit.addEventListener("click", () => {
              kitIn.value = p.KitNumber; nameIn.value = p.Name; licIn.value = p.LicenceNo;
              submitBtn.textContent = "Update Player"; submitBtn._editing = idx;
            });
            del.addEventListener("click", async () => {
              const m = showModal({ title: "Delete player", html: `<div>Delete ${escapeHtml(p.Name || "")} (${p.KitNumber})?</div>`, okText: "Delete", showCancel: true });
              const ok = await m.promise;
              if (!ok) return;
              playersArr.splice(idx, 1); renderList();
            });
            right.appendChild(edit); right.appendChild(del);
            row.appendChild(left); row.appendChild(right);
            list.appendChild(row);
          });
        }
        renderList();

        submitBtn.addEventListener("click", () => {
          const KitNumber = kitIn.value !== "" ? (isNaN(Number(kitIn.value)) ? -1 : (kitIn.value)) : -1;
          if (KitNumber < -1) { showToast("Error kit number"); return; }
          const Name = nameIn.value.trim() || "Player";
          const LicenceNo = licIn.value.trim() || "";
          const item = { KitNumber, Name, LicenceNo, Points: [], Fouls: [] };
          if (submitBtn._editing !== undefined) {
            playersArr[submitBtn._editing] = item;
            delete submitBtn._editing; submitBtn.textContent = "Add Player";
          } else {
            if (KitNumber > -2 && playersArr.some(p => p.KitNumber === KitNumber)) { showToast("Kit number already used"); return; }
            playersArr.push(item);
          }
          kitIn.value = ""; nameIn.value = ""; licIn.value = "";
          renderList();
        });

        return { rootNode, renderList };
      }

      const homeEditor = buildPlayerEditorPanel("Home Players", playersHome);
      const awayEditor = buildPlayerEditorPanel("Away Players", playersAway);

      const playersGrid = el("div", { class: "sb-dynamic" });
      playersGrid.appendChild(homeEditor.rootNode);
      playersGrid.appendChild(awayEditor.rootNode);
      panel.appendChild(playersGrid);

      panel.appendChild(el("hr"));

      // Save / Cancel controls at bottom of panel
      const controls = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:8px" });
      const saveBtn = el("button", { class: "sb-button" }, "Save Setup");
      const cancelBtn = el("button", { class: "sb-button ghost" }, "Close");
      controls.appendChild(cancelBtn); controls.appendChild(saveBtn);
      panel.appendChild(controls);

      cancelBtn.addEventListener("click", () => { setupOpen = false; panel.style.display = "none"; });

      saveBtn.addEventListener("click", () => {
        // read header fields
        const elHome = panel.querySelector("#s-home-name");
        const elAway = panel.querySelector("#s-away-name");
        const elLeague = panel.querySelector("#s-league");
        const elMatch = panel.querySelector("#s-matchno");
        const elArrow = panel.querySelector("#s-arrow");

        state.teams.Home.Name = elHome.value.trim() || state.teams.Home.Name;
        state.teams.Away.Name = elAway.value.trim() || state.teams.Away.Name;
        state.game.League = elLeague.value.trim();
        state.game.MatchNo = elMatch.value.trim();
        state.game.Arrow = elArrow.value;

        // apply local edited arrays
        if (Array.isArray(periods) && periods.length > 0) {
          state.game.PeriodsConfig = JSON.parse(JSON.stringify(periods));
          clock.updatePeriods(state.game.PeriodsConfig);
        }
        else showToast("Periods list empty; keeping existing config");

        state.game.Officials = JSON.parse(JSON.stringify(officials));
        if (playersHome.length) state.teams.Home.Players = JSON.parse(JSON.stringify(playersHome));
        if (playersAway.length) state.teams.Away.Players = JSON.parse(JSON.stringify(playersAway));

        rebuildPlayerMaps();
        pushHistory();
        renderAll();
        showToast("Setup saved");
        setupOpen = false;
        panel.style.display = "none";
      });
    }

    // helpers
    function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function printScore() {
      const w = window.open("", "_blank");
      const d = w.document;
      // Build the printable document using DOM APIs (avoid document.write)
      d.title = "Printable Score";
      const styleEl = d.createElement("style");
      styleEl.textContent = "body{font-family:sans-serif;padding:20px}"; 
      d.head.appendChild(styleEl);

      // Header
      const h1 = d.createElement("h1");
      h1.textContent = `${state.teams.Home.Name} ${computeScore("Home")} - ${computeScore("Away")} ${state.teams.Away.Name}`;
      d.body.appendChild(h1);

      // Period info
      const periodDiv = d.createElement("div");
      periodDiv.textContent = `Period: ${getPeriodLabel()}`;
      d.body.appendChild(periodDiv);
      d.body.appendChild(d.createElement("hr"));

      // Event log
      const h3 = d.createElement("h3");
      h3.textContent = "Event Log";
      d.body.appendChild(h3);
      const ol = d.createElement("ol");
      state.log.forEach(l => {
        const li = d.createElement("li");
        li.style.color = l.undone ? "#999" : "#000";
        const parts = [
          new Date(l.ts).toLocaleString(),
          ": ",
          l.type,
          l.team ? " " + l.team + ":" : "",
          l.kit !== undefined ? " #" + l.kit : "",
          l.payload && (l.payload.Number || l.payload.Type) ? " " + String(l.payload.Number || l.payload.Type) : ""
        ];
        li.textContent = parts.join("");
        ol.appendChild(li);
      });
      d.body.appendChild(ol);
      d.close(); w.focus(); w.print();
    }
    function download(filename, text) { const a = document.createElement("a"); const blob = new Blob([text], { type: "application/octet-stream" }); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
    function downloadDataUrl(dataUrl, filename) { const a = document.createElement("a"); a.href = dataUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }

    // persistence
    window.addEventListener("beforeunload", () => { try { localStorage.setItem("scoreboard_state", JSON.stringify(state)); } catch (e) { } });

    // initial render
    renderAll();
    showToast("Scoreboard ready");

    // API
    return {
      state, clock, events,
      logEvent, softDeleteLog, restoreLog, hardDeleteLog,
      exportJSON, exportCSV, exportImageDataURL,
      undo, redo, pushHistory,
      addPlayer(team, { Name = "", LicenceNo = "", KitNumber = -1 } = {}) {
        const pl = { Name, LicenceNo, KitNumber, Points: [], Fouls: [] };
        state.teams[team].Players.push(pl);
        rebuildPlayerMaps(); pushHistory(); renderAll();
      },
      setGameDetails(g) { Object.assign(state.game, g); pushHistory(); renderAll(); },
      setTeamDetails(team, t) { Object.assign(state.teams[team], t); rebuildPlayerMaps(); pushHistory(); renderAll(); },
      setPlayers(team, players) { state.teams[team].Players = players; rebuildPlayerMaps(); pushHistory(); renderAll(); }
    };
  }