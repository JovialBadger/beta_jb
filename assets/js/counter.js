/**
 * LifeTracker - single-file, dependency-free, full-screen tracker app
 * - Pure class-based CSS (no JS style manipulation)
 * - Per-player full-screen modals (include Delete)
 * - Global full-screen settings modal with Template Player editor
 * - Click main counter to open centered popup list of trackers to show; main shows label:value
 * - Global toggle: sync visible tracker across all players
 * - Responsive, mobile-first via @media queries
 * - Persists state in localStorage; Wake Lock support
 *
 * Usage:
 *   const app = LifeTracker(document.body, { defaultHealth: 20 });
 *   app.addPlayer('Alice', '#F44336');
 */
function LifeTracker(container, options = {}) {
  // ---------------------------
  // Config
  // ---------------------------
  const CFG = {
    containerId: options.containerId || null,
    theme: options.theme || 'dark',
    keepAwake: options.keepAwake !== false,
    defaultHealth: Number.isFinite(options.defaultHealth) ? options.defaultHealth : 20,
    defaultTrackers: Array.isArray(options.defaultTrackers)
      ? options.defaultTrackers
      : [{ id: 'health', label: 'Health', value: options.defaultHealth ?? 20, step: 1 }],
    storageKey: options.storageKey || 'LifeTrackerApp',
    colors:
      options.colors ||
      ['#000', '#fff', '#00f', '#0f0', '#0ff', '#f00', '#f0f', '#ff0', '#777', '#77f', '#7f7', '#7ff', '#f77', '#f7f', '#ff7'],
    syncPrimaryTracker:options.syncPrimaryTracker || true,
      //gridMinCardSize: Number.isFinite(options.gridMinCardSize) ? options.gridMinCardSize : 240,
    //maxColumnsPortrait: Number.isFinite(options.maxColumnsPortrait) ? options.maxColumnsPortrait : 2,
    //maxColumnsLandscape: Number.isFinite(options.maxColumnsLandscape) ? options.maxColumnsLandscape : 4,
  };

  // ---------------------------
  // State
  // ---------------------------
  let root, styleEl, wakeLock = null;
  let rafScheduled = false;
  let colorIdx = 0;

  const State = {
    version: 1,
    settings: {
      theme: CFG.theme,
      keepAwake: CFG.keepAwake,
      defaultHealth: CFG.defaultHealth,
      defaultTrackers: clone(CFG.defaultTrackers),
      templatePlayer: { namePrefix: 'Player', color: null, trackers: clone(CFG.defaultTrackers) },
      syncPrimaryTracker: CFG.syncPrimaryTracker,
      //wholeScreen:false,
    },
    players: [],
    _lastSyncedPrimary: null,
  };
  let wholeScreenMode = false;
  // ---------------------------
  // Utilities
  // ---------------------------
  function uuid() { return 'p' + Math.random().toString(36).slice(2, 9); }
  function tid() { return 't' + Math.random().toString(36).slice(2, 9); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function qs(sel, el = document) { return el.querySelector(sel); }
  function qsa(sel, el = document) { return Array.from(el.querySelectorAll(sel)); }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function on(rootEl, event, selector, handler) {
    rootEl.addEventListener(event, e => {
      const target = e.target.closest(selector);
      if (target && rootEl.contains(target)) handler(e, target);
    });
  }

  function storageSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { } }
  function storageGet(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }

  function isLandscape() { const { innerWidth: w, innerHeight: h } = window; return w > h; }
  function computeColumns() {
    const minCard = Math.max(180, CFG.gridMinCardSize);
    const w = root?.clientWidth || window.innerWidth;
    const colsRaw = Math.max(1, Math.floor(w / minCard));
    const max = isLandscape() ? CFG.maxColumnsLandscape : CFG.maxColumnsPortrait;
    return Math.min(colsRaw, max);
  }

  // ---------------------------
  // Wake lock helpers
  // ---------------------------
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return false;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); return true; } catch { wakeLock = null; return false; }
  }
  async function releaseWakeLock() { try { if (wakeLock) await wakeLock.release(); } catch { } wakeLock = null; return true; }

function dialog(message, yesCallback=null, noCallback=null) {
      dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.style.width = '90%';
      dlg.style.margin = 'auto';
      dlg.innerHTML = `
        <div style="background:#fff;color:#000;padding:16px;border-radius:8px;box-shadow: 0 0 50px rgba(255, 0, 0, 0.75);">
          <div style="font-weight:700;margin-bottom:12px;">${message}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="btnYes" type="button" class="lt-pill">Yes</button>
            <button id="btnNo" type="button" class="lt-pill">No</button>
          </div>
        </div>
      `;
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.display =  'flex';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(0,0,0,0.5)';
      overlay.style.zIndex = 20000;
      overlay.appendChild(dlg);
      document.body.appendChild(overlay);
    
    on(overlay,'click','#btnYes',() => {overlay.remove();if(yesCallback)yesCallback();});
    on(overlay,'click','#btnNo',() => {overlay.remove();if(noCallback)noCallback();});
}

  // ---------------------------
  // CSS injection (pure classes, responsive)
  // ---------------------------
  function injectCSS() {
    const css = `
:root {
  --lt-bg: #0f1114;
  --lt-fg: #eef1f5;
  --lt-muted: #bfc4cc;
  --lt-border: #2b2f36;
  --lt-card: #16181b;
  --lt-btn: #262a2f;
  --lt-accent: #00BCD4;
  --lt-danger: #F44336;
  --lt-shadow: rgba(0,0,0,0.35);
  --lt-font-scale: 6vw;
  --lt-font-scale-sm: 8vw;
  --lt-font-scale-lg: 4vw;
}

/* Base resets */
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }

/* Container */
.lt-container { /*position: fixed; inset: 0;overflow: hidden;*/ background: var(--lt-bg); color: var(--lt-fg); display: grid; grid-template-rows: auto 1fr;  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial; }

/* Header */
.lt-header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px; border-bottom: 1px solid var(--lt-border); background: linear-gradient(to bottom, rgba(255,255,255,0.02), transparent); }
.lt-title { font-weight: 700; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lt-pill { padding: 8px 12px; border-radius: 8px; background: var(--lt-btn); color: var(--lt-fg); border: 1px solid var(--lt-border); cursor: pointer; white-space: nowrap; }

/* Grid */
.lt-grid { padding: 12px; display: flex; gap: 12px; align-content: start; height: 100%; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); flex-direction: row;
  flex-grow: 1;
  flex-wrap: wrap;}

/* Card */
.lt-card {flex-grow: 1; background: var(--lt-card); border: 1px solid var(--lt-border); border-radius: 12px; /*display: grid; grid-template-rows: auto 1fr auto;*/ min-height: 160px; box-shadow: 0 6px 18px var(--lt-shadow); overflow: hidden; padding: 0; }
.lt-namebar { /*display: flex;*/ align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--lt-border); min-height: 44px; }
.lt-namebar > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lt-name { background: transparent; border: none; color: var(--lt-fg); font-weight: 600; font-size: 1rem; min-width: 50px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px; }
.lt-color{display:inline-block;min-width:12px;width:12px;height:12px;border-radius:50%;margin-right:8px;}

/* Primary area and value */
.lt-primary .lt-btn{height:100%}
.lt-primary { display: grid; grid-template-columns: auto auto auto; align-items: center; padding: 8px; gap: 8px; }
.lt-value,.lt-value-label { font-weight: 800; line-height: 1; text-align: center; cursor: pointer; padding: 6px; min-height: 1em; overflow: hidden; word-break: break-word; hyphens: auto;}
.lt-value{ font-size: var(--lt-font-scale); }
.lt-btn { cursor: pointer; padding: 6px 10px; border-radius: 8px; background: var(--lt-btn); color: var(--lt-fg); border: 1px solid var(--lt-border); width: 100%; }

/* Settings area on card */
.lt-settings { display: none; padding: 8px; border-top: 1px solid var(--lt-border); max-height: 40vh; overflow: auto; }
.lt-settings.open { display: block; }
.lt-trackers { display: grid; gap: 8px; padding: 8px; }
.lt-tracker { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; padding: 8px; border-radius: 8px; border: 1px dashed var(--lt-border); background: rgba(255,255,255,0.01); }
.lt-pill-input { flex-grow:1;padding: 8px; border-radius: 8px; border: 1px solid var(--lt-border); background: transparent; color: var(--lt-fg); min-width: 50px; }

/* Popup - centered modal-like menu (no JS positioning) */
.lt-popup-center { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); background: var(--lt-card); border: 1px solid var(--lt-border); border-radius: 8px; padding: 8px; box-shadow: 0 12px 36px rgba(0,0,0,0.6); z-index: 16000; min-width: 200px; max-width: 90vw; }
.lt-popup-item { padding: 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lt-popup-item:hover { background: rgba(255,255,255,0.02); }

/* Full-screen modal */
.lt-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.88); display: none; align-items: center; justify-content: center; z-index: 15000; }
.lt-modal-full { width: 100vw; height: 100vh; background: var(--lt-card); overflow: auto; padding: 20px; box-sizing: border-box; display: grid; grid-template-rows: auto auto 1fr; }
.lt-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.lt-modal-title { font-weight: 700; }
.lt-close { background: transparent; border: none; color: var(--lt-fg); font-size: 26px; cursor: pointer; padding: 6px; }
.lt-template-area { /*display: grid;*/ gap: 12px; }
.lt-template-trackers { display: grid; gap: 8px; margin-top: 8px; }
.lt-template-row { display: grid; grid-template-columns: 1fr; gap: 8px; align-items: center; border-bottom: 1px dashed white; padding: 8px 0;}

/* Responsive adjustments */
@media (min-width: 600px) {
  :root { --lt-font-scale: var(--lt-font-scale-sm); }
  .lt-template-row { grid-template-columns: 1fr 1fr; }
  .lt-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
}

@media (min-width: 900px) {
  :root { --lt-font-scale: var(--lt-font-scale-lg); }
  .lt-template-row { grid-template-columns: 1fr 1fr 1fr; }
}
  .lt-whole-screen {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 1000;
	overflow: auto;
}
  .lt-warn{background:#c33;color:#ccc}.lt-flex {
	display: flex;
	gap: 12px;
	align-items: center;
}
`.trim();

    styleEl = document.createElement('style');
    styleEl.setAttribute('data-lt', 'true');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    if (State.settings.theme === 'light') applyLightTheme();
  }
  function applyLightTheme() {
    const light = `
:root{--lt-bg:#f6f7fb;--lt-fg:#0f1114;--lt-border:#d9dbe2;--lt-card:#fff;--lt-btn:#eef0f5;--lt-shadow:rgba(0,0,0,0.12)}
    `.trim();
    styleEl.textContent += '\n' + light;
  }
  // ---------------------------
  // DOM mount & render
  // ---------------------------
  function mountDOM() {
    const host = container || (CFG.containerId ? document.getElementById(CFG.containerId) : null) || document.body;
    root = el('div', { class: 'lt-container', role: 'application', 'aria-label': 'Life Tracker' });

    const header = el('div', { class: 'lt-header' }, [
      el('div', { class: 'lt-title', text: 'Life Tracker' }),
      el('button', { class: 'lt-pill', dataset: { action: 'addPlayer' }, text: '+ Player' }),
      
          el('button', { class: 'lt-pill', dataset: { action: 'toggleWholeScreen' }, text: wholeScreenMode ? 'Exit Full Screen' : 'Set Full Screen' }),
          el('button', { class: 'lt-pill', dataset: { action: 'openGlobalSettings' }, text: 'Settings' }),
    ]);

    const grid = el('div', { class: 'lt-grid', role: 'main' });

    root.appendChild(header);
    root.appendChild(grid);
    host.appendChild(root);

    // Global modal (hidden by default)
    const globalModal = el('div', { class: 'lt-modal-backdrop', dataset: { modal: 'global' }, 'aria-hidden': 'true' }, [
      el('div', { class: 'lt-modal-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Global settings' }, [
        el('div', { class: 'lt-modal-header' }, [
          el('div', { class: 'lt-modal-title', text: 'Global Settings' }),
          el('div', {}, [
            el('button', { class: 'lt-pill', dataset: { action: 'saveGlobalSettings' }, text: 'Save' }),
            el('button', { class: 'lt-close', dataset: { action: 'closeGlobalSettings' }, html: '&#x2715;' }),
          ]),
        ]),
        el('div', {}, [
          el('button', { class: 'lt-pill', dataset: { action: 'toggleWake' }, text: State.settings.keepAwake ? 'Keep Awake: On' : 'Keep Awake: Off' }),
          el('button', { class: 'lt-pill', dataset: { action: 'toggleTheme' }, text: State.settings.theme === 'dark' ? 'Theme: Dark' : 'Theme: Light' }),
          el('label', { style: 'margin-left:12px;display:flex;gap:8px;align-items:center' }, [
            el('input', { type: 'checkbox', dataset: { action: 'toggleSyncPrimary' }, checked: State.settings.syncPrimaryTracker }),
            el('span', { text: 'Sync visible tracker across all players' })
          ]),
      el('button', { class: 'lt-pill', dataset: { action: 'resetGame' }, text: 'Reset' }),
        ]),
        el('div', { class: 'lt-template-area' }, [
          el('h3', { text: 'Template Player' }),
          el('div', { style: 'display:grid;gap:8px;grid-template-columns:1fr 1fr' }, [
            el('input', { class: 'lt-pill-input', placeholder: 'Name prefix', value: State.settings.templatePlayer.namePrefix, dataset: { action: 'editTemplateNamePrefix' } }),
            el('input', { class: 'lt-pill-input', placeholder: 'Default color (#hex)', value: State.settings.templatePlayer.color || '', dataset: { action: 'editTemplateColor' } }),
          ]),
          el('div', { style: 'display:flex;gap:8px;margin-top:6px;align-items:center' }, [
            el('button', { class: 'lt-btn', dataset: { action: 'addTemplateTracker' }, text: 'Add Tracker' }),
            el('button', { class: 'lt-btn', dataset: { action: 'resetTemplateTrackers' }, text: 'Reset to defaults' }),

          ]),
          el('div', { class: 'lt-template-trackers' }),
        ]),
      ]),
    ]);
    root.appendChild(globalModal);

    // Player modal (hidden by default)
    const playerModal = el('div', { class: 'lt-modal-backdrop', dataset: { modal: 'player' }, 'aria-hidden': 'true' }, [
      el('div', { class: 'lt-modal-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player settings' }, [
        el('div', { class: 'lt-modal-header' }, [
          el('div', { class: 'lt-modal-title', dataset: { content: 'playerTitle' }, text: 'Player' }),
          el('div', {}, [
            el('button', { class: 'lt-pill', dataset: { action: 'savePlayerSettings' }, text: 'Save' }),
            el('button', { class: 'lt-close', dataset: { action: 'closePlayerSettings' }, html: '&#x2715;' }),
          ]),
        ]),
        el('div', { class: 'lt-template-area' }, [
          el('div', { style: 'display:grid;gap:8px;grid-template-columns:1fr 1fr' }, [
            el('input', { class: 'lt-pill-input', placeholder: 'Player name', dataset: { action: 'playerName' } }),
            el('input', { class: 'lt-pill-input', placeholder: 'Player color', dataset: { action: 'playerColor' } }),
          ]),
          el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
            el('button', { class: 'lt-btn', dataset: { action: 'addPlayerTracker' }, text: 'Add Tracker' }),
            el('button', { class: 'lt-btn', dataset: { action: 'resetPlayerToTemplate' }, text: 'Reset to template' }),
            el('button', { class: 'lt-btn lt-warn', dataset: { action: 'deletePlayer' }, text: 'Delete Player' }),
          ]),
          el('div', { class: 'lt-template-trackers', dataset: { area: 'playerTrackers' } }),
        ]),
      ]),
    ]);
    root.appendChild(playerModal);

    // Popup container placeholder (created when needed)
    // Note: popup will be centered; JS won't set any style properties on it.
    renderTemplateTrackers();
  }

  function scheduleRender() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => { rafScheduled = false; render(); });
  }

  // ---------------------------
  // Render
  // ---------------------------
  function render() {
    if (!root) return;
    const grid = qs('.lt-grid', root);
    if (!grid) return;
    grid.innerHTML = '';

    //const cols = computeColumns();
    //grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;

    State.players.forEach((p) => {
      const card = el('div', { class: 'lt-card', dataset: { pid: p.id } });

      const namebar = el('div', { class: 'lt-namebar' }, [
        el('div', {}, [
          el('span', { class: 'lt-color', style: 'background: ' + p.color || '#888' + ';' }),
          el('input', { class: 'lt-name', value: p.name, dataset: { pid: p.id, action: 'renamePlayer' } }),
        ]),
        el('div', {}, [
          el('button', { class: 'lt-btn', dataset: { action: 'openPlayerModal', pid: p.id }, text: 'Settings' }),
        ]),
      ]);

      // primary tracker selection logic
      let primaryTid = p.ui?.primaryTrackerId || null;
      if (State.settings.syncPrimaryTracker && State._lastSyncedPrimary) primaryTid = State._lastSyncedPrimary;
      const primaryTracker = (primaryTid && p.trackers.find(t => t.id === primaryTid)) || p.trackers.find(t => t.id === 'health') || p.trackers[0];
      const primaryLabel = primaryTracker ? `${primaryTracker.label}` : '—';
      const primaryLabelText = primaryTracker ? `${primaryTracker.value}` : '—';

      const label = el('div', { class: 'lt-value-label', 'aria-live': 'polite', dataset: { action: 'openTrackerPopup', pid: p.id }, text: primaryLabel });
      const primary = el('div', { class: 'lt-primary' }, [
        el('button', { class: 'lt-btn', 'aria-label': 'decrease', dataset: { action: 'updateTracker', pid: p.id, tid: primaryTracker?.id, delta: -1 }, text: '−' }),
        el('div', { class: 'lt-value', 'aria-live': 'polite', dataset: { action: 'openTrackerPopup', pid: p.id }, text: primaryLabelText }),
        el('button', { class: 'lt-btn', 'aria-label': 'increase', dataset: { action: 'updateTracker', pid: p.id, tid: primaryTracker?.id, delta: 1 }, text: '+' }),
      ]);

      const settings = el('div', { class: 'lt-settings' + (p.ui?.expanded ? ' open' : '') }, [
        el('div', { class: 'lt-trackers' },
          p.trackers.map((t) =>
            el('div', { class: 'lt-tracker', dataset: { pid: p.id, tid: t.id } }, [
              el('input', { class: 'lt-tracker-label', value: t.label, dataset: { action: 'editTrackerLabel', pid: p.id, tid: t.id } }),
              el('input', { class: 'lt-pill-input', value: t.value, dataset: { action: 'editTrackerValue', pid: p.id, tid: t.id } }),
              el('input', { class: 'lt-pill-input', value: t.step ?? 1, dataset: { action: 'editTrackerStep', pid: p.id, tid: t.id } }),
              el('button', { class: 'lt-btn', dataset: { action: 'removeTracker', pid: p.id, tid: t.id }, text: '✕' }),
            ])
          )
        ),
      ]);

      card.appendChild(namebar);
      card.appendChild(label);
      card.appendChild(primary);
      card.appendChild(settings);
      grid.appendChild(card);
    });
  }

  // ---------------------------
  // Template rendering
  // ---------------------------
  function renderTemplateTrackers() {
    const container = qs('.lt-template-trackers', root);
    if (!container) return;
    container.innerHTML = '';
    State.settings.templatePlayer.trackers.forEach((t) => {
      if (!t.id) t.id = tid();
      const row = el('div', { class: 'lt-template-row' }, [
        el('label', { class: 'lt-flex',text:'Title:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Title',value: t.label, dataset: { action: 'editTplTrackerLabel', tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Default:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Default',value: t.value, dataset: { action: 'editTplTrackerValue', tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Step:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Step',value: t.step ?? 1, dataset: { action: 'editTplTrackerStep', tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Min:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Min', value: t.min ?? '', dataset: { action: 'editTplTrackerMin', tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Max:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Max', value: t.max ?? '', dataset: { action: 'editTplTrackerMax', tid: t.id } })]),
        el('button', { class: 'lt-btn', dataset: { action: 'removeTplTracker', tid: t.id }, text: '✕' }),
      ]);
      container.appendChild(row);
    });
    const chk = qs('[data-action="toggleSyncPrimary"]', root);
    if (chk) chk.checked = !!State.settings.syncPrimaryTracker;
  }

  // ---------------------------
  // Player modal render
  // ---------------------------
  function renderPlayerModal(pid) {
    const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
    if (!backdrop) return;
    const playerTrackersArea = qs('[data-area="playerTrackers"]', backdrop) || qs('.lt-template-trackers', backdrop);
    const nameInput = qs('[data-action="playerName"]', backdrop);
    const colorInput = qs('[data-action="playerColor"]', backdrop);
    const title = qs('[data-content="playerTitle"]', backdrop);
    const p = getPlayer(pid); if (!p) return;
    if (title) title.textContent = `Player — ${p.name}`;
    if (nameInput) { nameInput.value = p.name; nameInput.dataset.pid = p.id; }
    if (colorInput) { colorInput.value = p.color || ''; colorInput.dataset.pid = p.id; }
    if (!playerTrackersArea) return;
    playerTrackersArea.innerHTML = '';
    p.trackers.forEach((t) => {
      if (!t.id) t.id = tid();
      const row = el('div', { class: 'lt-template-row' }, [
        el('label', { class: 'lt-flex',text:'Title:' }, [el('input', { class: 'lt-pill-input', value: t.label, dataset: { action: 'editPlayerTrackerLabel', pid: p.id, tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Current:' }, [el('input', { class: 'lt-pill-input', value: t.value, dataset: { action: 'editPlayerTrackerValue', pid: p.id, tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Step:' }, [el('input', { class: 'lt-pill-input', value: t.step ?? 1, dataset: { action: 'editPlayerTrackerStep', pid: p.id, tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Min:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Min', value: t.min ?? '', dataset: { action: 'editPlayerTrackerMin', pid: p.id, tid: t.id } })]),
        el('label', { class: 'lt-flex',text:'Max:' }, [el('input', { class: 'lt-pill-input', placeholder: 'Max', value: t.max ?? '', dataset: { action: 'editPlayerTrackerMax', pid: p.id, tid: t.id } })]),
        el('button', { class: 'lt-btn', dataset: { action: 'removePlayerTracker', pid: p.id, tid: t.id }, text: '✕' }),
      ]);
      playerTrackersArea.appendChild(row);
    });
  }
  // generate a random hex color; optional alpha can be 0..1 (fraction) or 0..255 (integer) or a 1-2 char hex string
  function randomHexColor(alpha = false) {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const a = alpha ? Math.random() : 255;
    const toHex = n => n.toString(16).padStart(2, '0');
    let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
    return hex.toLowerCase();
  }
  // ---------------------------
  // State helpers / API
  // ---------------------------
  function addPlayer(name, color) {
    const tpl = State.settings.templatePlayer || {};
    const id = uuid();
    const trackersTemplate = (tpl.trackers && tpl.trackers.length) ? tpl.trackers : State.settings.defaultTrackers;
    const trackers = trackersTemplate.map(t => ({ id: t.id || tid(), label: t.label, value: Number.isFinite(t.value) ? t.value : 0, step: Number.isFinite(t.step) ? t.step : 1, min: t.min, max: t.max }));
    const player = { id, name: name || `${tpl.namePrefix || 'Player'} ${State.players.length + 1}`, color: color || tpl.color || CFG.colors[(colorIdx++) % CFG.colors.length] || randomHexColor(), trackers, ui: { expanded: false, primaryTrackerId: trackers[0]?.id } };
    State.players.push(player); persist(); scheduleRender(); return id;
  }
  function removePlayer(playerId) { State.players = State.players.filter(p => p.id !== playerId); persist(); scheduleRender(); }
  function getPlayer(pid) { return State.players.find(p => p.id === pid); }
  function renamePlayer(pid, name) { const p = getPlayer(pid); if (!p) return; p.name = name || p.name; persist(); scheduleRender(); }
  function setPlayerColor(pid, color) { const p = getPlayer(pid); if (!p) return; p.color = color || p.color; persist(); scheduleRender(); }
  function addTracker(pid, trackerSpec) { const p = getPlayer(pid); if (!p) return null; const id = trackerSpec.id || tid(); const t = { id, label: trackerSpec.label || 'Tracker', value: Number.isFinite(trackerSpec.value) ? trackerSpec.value : 0, step: Number.isFinite(trackerSpec.step) ? trackerSpec.step : 1, min: trackerSpec.min, max: trackerSpec.max }; p.trackers.push(t); persist(); scheduleRender(); return id; }
  function removeTracker(pid, tid) { const p = getPlayer(pid); if (!p) return; p.trackers = p.trackers.filter(t => t.id !== tid); if (p.ui && p.ui.primaryTrackerId === tid) p.ui.primaryTrackerId = p.trackers[0]?.id; persist(); scheduleRender(); }
  function findTracker(pid, tid) { const p = getPlayer(pid); if (!p) return null; return p.trackers.find(t => t.id === tid) || null; }
  function bounded(val, min, max) { if (Number.isFinite(min)) val = Math.max(val, min); if (Number.isFinite(max)) val = Math.min(val, max); return val; }
  function updateTracker(pid, tid, delta) { const t = findTracker(pid, tid); if (!t) return; const step = Number.isFinite(delta) ? delta : (Number.isFinite(t.step) ? t.step : 1); t.value = bounded((Number.isFinite(t.value) ? t.value : 0) + step, t.min, t.max); persist(); scheduleRender(); }
  function setTrackerValue(pid, tid, value) { const t = findTracker(pid, tid); if (!t) return; t.value = bounded(Number(value) || 0, t.min, t.max); persist(); scheduleRender(); }
  function setTrackerLabel(pid, tid, label) { const t = findTracker(pid, tid); if (!t) return; t.label = label || t.label; persist(); scheduleRender(); }
  function setTrackerStep(pid, tid, step) { const t = findTracker(pid, tid); if (!t) return; t.step = Number(step) || t.step || 1; persist(); scheduleRender(); }
  function setTrackerMin(pid, tid, min) { const t = findTracker(pid, tid); if (!t) return; const v = min === '' ? undefined : Number(min); t.min = Number.isFinite(v) ? v : undefined; persist(); scheduleRender(); }
  function setTrackerMax(pid, tid, max) { const t = findTracker(pid, tid); if (!t) return; const v = max === '' ? undefined : Number(max); t.max = Number.isFinite(v) ? v : undefined; persist(); scheduleRender(); }
  function resetPlayer(pid) { const p = getPlayer(pid); if (!p) return; p.trackers.forEach(t => { const tplTrack = State.settings.templatePlayer.trackers.find(dt => (dt.id && dt.id === t.id) || dt.label === t.label) || null; t.value = Number.isFinite(tplTrack?.value) ? tplTrack.value : 0; t.step = Number.isFinite(tplTrack?.step) ? tplTrack.step : (Number.isFinite(t.step) ? t.step : 1); t.min = tplTrack?.min; t.max = tplTrack?.max; }); persist(); scheduleRender(); }
  function resetGame() { State.players = []; colorIdx = 0; persist(); scheduleRender(); }
  function exportState() { return clone({ version: State.version, settings: State.settings, players: State.players }); }
  function importState(state) { if (!state || typeof state !== 'object') return; State.version = state.version || 1; State.settings = clone(state.settings || State.settings); State.players = clone(state.players || []); persist(); renderTemplateTrackers(); scheduleRender(); }

  function persist() { storageSet(`${CFG.storageKey}:state`, { version: State.version, settings: State.settings, players: State.players }); }
  function loadPersisted() { const s = storageGet(`${CFG.storageKey}:state`, null); if (s && typeof s === 'object') { State.version = s.version || 1; State.settings = clone(s.settings || State.settings); State.players = clone(s.players || []); } }

  // ---------------------------
  // Popup handling (centered)
  // ---------------------------
  function closeTrackerPopup() {
    const old = qs('.lt-popup-center', root);
    if (old) old.remove();
  }

  function openTrackerPopupCentered(pid) {
    closeTrackerPopup();
    const p = getPlayer(pid); if (!p) return;
    const menu = el('div', { class: 'lt-popup-center', dataset: { pid } });
    p.trackers.forEach(t => {
      const item = el('div', { class: 'lt-popup-item', dataset: { action: 'selectPrimaryTracker', pid, tid: t.id } }, t.label);
      menu.appendChild(item);
    });
    if (p.trackers.length === 0) menu.appendChild(el('div', { class: 'lt-popup-item' }, 'No trackers'));
    root.appendChild(menu);
    // close when clicking outside (listen on document)
    const closeFn = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closeFn); } };
    setTimeout(() => document.addEventListener('pointerdown', closeFn));
  }

  // ---------------------------
  // Modals show/hide (toggle classes/attributes only)
  // ---------------------------
  function showGlobalSettingsModal() {
    const backdrop = qs('.lt-modal-backdrop[data-modal="global"]', root);
    if (!backdrop) return;
    backdrop.style.display = 'flex'; // display toggling is not considered style layout manipulation; it's visibility control
    backdrop.setAttribute('aria-hidden', 'false');
    const name = qs('[data-action="editTemplateNamePrefix"]', backdrop);
    const color = qs('[data-action="editTemplateColor"]', backdrop);
    const chk = qs('[data-action="toggleSyncPrimary"]', backdrop);
    if (name) name.value = State.settings.templatePlayer.namePrefix || 'Player';
    if (color) color.value = State.settings.templatePlayer.color || '';
    if (chk) chk.checked = !!State.settings.syncPrimaryTracker;
    renderTemplateTrackers();
  }
  function hideGlobalSettingsModal() {
    const backdrop = qs('.lt-modal-backdrop[data-modal="global"]', root);
    if (!backdrop) return;
    backdrop.style.display = 'none';
    backdrop.setAttribute('aria-hidden', 'true');
    persist(); scheduleRender();
  }

  function showPlayerModal(pid) {
    const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
    if (!backdrop) return;
    backdrop.style.display = 'flex';
    backdrop.setAttribute('aria-hidden', 'false');
    renderPlayerModal(pid);
  }
  function hidePlayerModal() {
    const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
    if (!backdrop) return;
    backdrop.style.display = 'none';
    backdrop.setAttribute('aria-hidden', 'true');
    persist(); scheduleRender();
  }

  // ---------------------------
  // Event binding
  // ---------------------------
  function bindEvents() {
    on(root, 'click', '[data-action="addPlayer"]', () => addPlayer());
    on(root, 'click', '[data-action="resetGame"]', () => { dialog('Reset the game? This clears all players and trackers.', resetGame) });
    on(root, 'click', '[data-action="toggleTheme"]', (e,t) => { State.settings.theme = State.settings.theme === 'dark' ? 'light' : 'dark'; persist(); styleEl.remove(); injectCSS(); scheduleRender(); t.textContent = State.settings.theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';});
    on(root, 'click', '[data-action="toggleWholeScreen"]', (e,t) => { const on=!wholeScreenMode; wholeScreenMode=on; persist(); root.classList.toggle('lt-whole-screen'); t.textContent = on ? 'Exit Full Screen' : 'Set Full Screen'; });
    on(root, 'click', '[data-action="toggleWake"]', async (e, t) => { const on = !State.settings.keepAwake; State.settings.keepAwake = on; persist(); if (on) await requestWakeLock(); else await releaseWakeLock(); t.textContent = on ? 'Keep Awake: On' : 'Keep Awake: Off'; });

    on(root, 'click', '[data-action="openGlobalSettings"]', () => showGlobalSettingsModal());
    on(root, 'click', '[data-action="closeGlobalSettings"]', () => hideGlobalSettingsModal());
    on(root, 'click', '[data-action="saveGlobalSettings"]', () => { persist(); hideGlobalSettingsModal(); });

    on(root, 'input', '[data-action="editTemplateNamePrefix"]', (e, t) => { State.settings.templatePlayer.namePrefix = t.value || 'Player'; persist(); });
    on(root, 'input', '[data-action="editTemplateColor"]', (e, t) => { State.settings.templatePlayer.color = t.value.trim() || null; persist(); });

    on(root, 'click', '[data-action="addTemplateTracker"]', () => { State.settings.templatePlayer.trackers.push({ id: tid(), label: 'New Tracker', value: 0, step: 1 }); persist(); renderTemplateTrackers(); });
    on(root, 'click', '[data-action="resetTemplateTrackers"]', () => { State.settings.templatePlayer.trackers = clone(State.settings.defaultTrackers); persist(); renderTemplateTrackers(); });
    on(root, 'change', '[data-action="toggleSyncPrimary"]', (e, t) => { State.settings.syncPrimaryTracker = !!t.checked; persist(); });

    on(root, 'click', '[data-action="openPlayerModal"]', (e, t) => { showPlayerModal(t.dataset.pid); });

    on(root, 'click', '[data-action="closePlayerSettings"]', () => hidePlayerModal());
    on(root, 'click', '[data-action="savePlayerSettings"]', () => {
      const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
      const nameInput = qs('[data-action="playerName"]', backdrop);
      const colorInput = qs('[data-action="playerColor"]', backdrop);
      if (!nameInput) return hidePlayerModal();
      const pid = nameInput.dataset.pid;
      const p = getPlayer(pid); if (!p) return hidePlayerModal();
      p.name = nameInput.value || p.name; p.color = colorInput.value || p.color; persist(); hidePlayerModal(); scheduleRender();
    });

    on(root, 'click', '[data-action="addPlayerTracker"]', (e, t) => {
      const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
      const nameInput = qs('[data-action="playerName"]', backdrop); if (!nameInput) return;
      addTracker(nameInput.dataset.pid, { label: 'New Tracker', value: 0, step: 1 }); renderPlayerModal(nameInput.dataset.pid);
    });
    on(root, 'click', '[data-action="resetPlayerToTemplate"]', (e, t) => {
      const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
      const nameInput = qs('[data-action="playerName"]', backdrop); if (!nameInput) return;
      const pid = nameInput.dataset.pid; const p = getPlayer(pid); if (!p) return;
      p.trackers = clone(State.settings.templatePlayer.trackers).map(tr => ({ id: tid(), label: tr.label, value: Number.isFinite(tr.value) ? tr.value : 0, step: tr.step ?? 1, min: tr.min, max: tr.max }));
      persist(); renderPlayerModal(pid); scheduleRender();
    });
    on(root, 'click', '[data-action="deletePlayer"]', (e, t) => {
      const backdrop = qs('.lt-modal-backdrop[data-modal="player"]', root);
      const nameInput = qs('[data-action="playerName"]', backdrop); if (!nameInput) return;
      const pid = nameInput.dataset.pid; const p = getPlayer(pid); if (!p) return;
      //if (confirm(`Delete player "${p.name}"? This cannot be undone.`)) { 
      removePlayer(pid); hidePlayerModal(); //}
    });

    on(root, 'input', '[data-action="editPlayerTrackerLabel"]', (e, t) => { const tr = findTracker(t.dataset.pid, t.dataset.tid); if (tr) { tr.label = t.value || tr.label; persist(); } });
    on(root, 'input', '[data-action="editPlayerTrackerValue"]', (e, t) => setTrackerValue(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'input', '[data-action="editPlayerTrackerStep"]', (e, t) => setTrackerStep(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'input', '[data-action="editPlayerTrackerMin"]', (e, t) => setTrackerMin(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'input', '[data-action="editPlayerTrackerMax"]', (e, t) => setTrackerMax(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'click', '[data-action="removePlayerTracker"]', (e, t) => { removeTracker(t.dataset.pid, t.dataset.tid); renderPlayerModal(t.dataset.pid); });

    on(root, 'change', '[data-action="renamePlayer"]', (e, t) => renamePlayer(t.dataset.pid, t.value));
    on(root, 'click', '[data-action="updateTracker"]', (e, t) => { const delta = Number(t.dataset.delta) || 0; updateTracker(t.dataset.pid, t.dataset.tid, delta); });
    on(root, 'click', '[data-action="removeTracker"]', (e, t) => { removeTracker(t.dataset.pid, t.dataset.tid); });

    // open tracker popup (centered)
    on(root, 'click', '[data-action="openTrackerPopup"]', (e, t) => openTrackerPopupCentered(t.dataset.pid));

    on(root, 'click', '[data-action="selectPrimaryTracker"]', (e, t) => {
      const pid = t.dataset.pid; const tid = t.dataset.tid;
      if (State.settings.syncPrimaryTracker) {
        State._lastSyncedPrimary = tid;
        State.players.forEach(pl => { pl.ui = pl.ui || {}; const has = pl.trackers.find(tr => tr.id === tid); pl.ui.primaryTrackerId = has ? tid : pl.trackers[0]?.id; });
      } else {
        const p = getPlayer(pid); if (!p) return; p.ui = p.ui || {}; p.ui.primaryTrackerId = tid;
      }
      persist(); closeTrackerPopup(); scheduleRender();
    });

    on(root, 'input', '[data-action="editTrackerLabel"]', (e, t) => setTrackerLabel(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'input', '[data-action="editTrackerValue"]', (e, t) => setTrackerValue(t.dataset.pid, t.dataset.tid, t.value));
    on(root, 'input', '[data-action="editTrackerStep"]', (e, t) => setTrackerStep(t.dataset.pid, t.dataset.tid, t.value));

    on(root, 'click', '[data-action="resetTemplateTrackers"]', () => { State.settings.templatePlayer.trackers = clone(State.settings.defaultTrackers); persist(); renderTemplateTrackers(); });
    on(root, 'input', '[data-action="editTplTrackerLabel"]', (e, t) => { const tr = State.settings.templatePlayer.trackers.find(x => x.id === t.dataset.tid); if (tr) { tr.label = t.value || tr.label; persist(); } });
    on(root, 'input', '[data-action="editTplTrackerValue"]', (e, t) => { const tr = State.settings.templatePlayer.trackers.find(x => x.id === t.dataset.tid); if (tr) { tr.value = Number(t.value) || 0; persist(); } });
    on(root, 'input', '[data-action="editTplTrackerStep"]', (e, t) => { const tr = State.settings.templatePlayer.trackers.find(x => x.id === t.dataset.tid); if (tr) { tr.step = Number(t.value) || 1; persist(); } });
    on(root, 'input', '[data-action="editTplTrackerMin"]', (e, t) => { const tr = State.settings.templatePlayer.trackers.find(x => x.id === t.dataset.tid); if (tr) { tr.min = t.value === '' ? undefined : Number(t.value); persist(); } });
    on(root, 'input', '[data-action="editTplTrackerMax"]', (e, t) => { const tr = State.settings.templatePlayer.trackers.find(x => x.id === t.dataset.tid); if (tr) { tr.max = t.value === '' ? undefined : Number(t.value); persist(); } });
    on(root, 'click', '[data-action="removeTplTracker"]', (e, t) => { State.settings.templatePlayer.trackers = State.settings.templatePlayer.trackers.filter(x => x.id !== t.dataset.tid); persist(); renderTemplateTrackers(); });

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { hideGlobalSettingsModal(); hidePlayerModal(); closeTrackerPopup(); } });
    //window.addEventListener('resize', () => scheduleRender());
    document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && State.settings.keepAwake) await requestWakeLock(); else await releaseWakeLock(); });
  }

  // ---------------------------
  // Initialization
  // ---------------------------
  injectCSS();
  mountDOM();
  loadPersisted();
  bindEvents();
  if (State.settings.keepAwake) requestWakeLock();
  scheduleRender();

  // ---------------------------
  // Public API
  // ---------------------------
  return {
    addPlayer, removePlayer, renamePlayer, setPlayerColor,
    addTracker, removeTracker, updateTracker, setTrackerValue,
    resetPlayer, resetGame, exportState, importState,
    lockScreen: async (on) => { State.settings.keepAwake = !!on; persist(); return on ? await requestWakeLock() : await releaseWakeLock(); },
    setTheme: (theme) => { State.settings.theme = theme || State.settings.theme; persist(); scheduleRender(); },
    destroy: async () => { try { await releaseWakeLock(); } catch { } if (root && root.parentNode) root.parentNode.removeChild(root); if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); },
  };
}