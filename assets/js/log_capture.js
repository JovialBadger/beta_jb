/*!
 * LogCapture — single-file, zero-dependency diagnostics with toasties, settings modal, and persistent logs.
 * Usage:
 *   const lc = new LogCapture({ settingsButtonSelector: '#log-settings-button' });
 *   // Or later: lc.attachSettingsButton('#some-button');
 */
class LogCapture {
  constructor(config = {}) {
    // ---- Defaults ----
    this.defaultSettings = {
      // Which console/error types to capture
      capture: { error: true, warn: true, log: true, info: true },
      // Toasty visibility
      showToasties: true,
      // Auto-dismiss toasties and timeout (ms)
      autoDismiss: true,
      dismissTime: 5000,
      // Log level threshold (capture only >= selected level)
      // Order: info < log < warn < error (error is highest severity)
      logLevel: 'info',
      // Persist logs across reloads and limit stored quantity
      persistLogs: false,
      maxLogs: 100,
      // Where the settings button is located
      settingsButtonSelector: '[data-log-settings-button]',
      // Inject CSS automatically
      injectCSS: true
    };

    // ---- Internal State ----
    this.settings = this._mergeDeep(this.defaultSettings, config, this._loadSettings());
    this.logs = this.settings.persistLogs ? this._loadLogs() : [];
    this.logMap = new Map(); // key: type + JSON(args) -> {type,args,timestamp,count,toasty?}
    this.logModalEl = null;
    this.settingsModalEl = null;
    this.toastyContainer = null;
    this.levelOrder = ['info', 'log', 'warn', 'error'];

    // ---- Init ----
    if (this.settings.injectCSS) this._injectCSS();
    this._ensureContainers();
    this.attachSettingsButton(this.settings.settingsButtonSelector);
    this._hookConsole();
    this._hookErrors();
  }

  // =========================
  // Public API
  // =========================
  attachSettingsButton(selector) {
    // Wait for DOM ready before attaching button
    //document.addEventListener('DOMContentLoaded', () => {
      const settingBtn = document.createElement('button');
      settingBtn.textContent = '⚙ Console Logs';
      const btn = document.querySelector(selector);
      if (btn) {
        btn.appendChild(settingBtn);
      } else {
        document.body.appendChild(settingBtn);
      }
      settingBtn.addEventListener('click', () => this.showSettingsModal());
    //});
  }

  showSettingsModal() {
    if (this.settingsModalEl) {
      this.settingsModalEl.remove();
      this.settingsModalEl = null;
    }
    this.settingsModalEl = this._createSettingsModal();
    document.body.appendChild(this.settingsModalEl);
  }

  showLogModal() {
    if (!this.logModalEl) {
      this.logModalEl = this._createLogModal();
      document.body.appendChild(this.logModalEl);
    }
    this._renderLogModalContent();
    this.logModalEl.style.display = 'block';
  }

  hideLogModal() {
    if (this.logModalEl) this.logModalEl.style.display = 'none';
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
    this.logMap.clear();
    this._saveLogs(); // will clear storage if persist enabled
    this._renderLogModalContent();
  }

  // =========================
  // Capture and Processing
  // =========================
  _hookConsole() {
    ['log', 'warn', 'error', 'info'].forEach(type => {
      const original = console[type];
      console[type] = (...args) => {
        try {
          if (this.settings.capture[type]) {
            this._capture(type, args);
          }
        } catch (err) {
          // Fail-safe: never break the console
        } finally {
          original.apply(console, args);
        }
      };
    });
  }

  _hookErrors() {
    window.addEventListener('error', event => {
      if (!this.settings.capture.error) return;
      const detail = [
        event.message,
        `at ${event.filename}:${event.lineno}:${event.colno}`
      ];
      this._capture('error', detail);
    });

    window.addEventListener('unhandledrejection', event => {
      if (!this.settings.capture.error) return;
      let reason;
      try {
        if (event.reason instanceof Error) {
          reason = `${event.reason.name}: ${event.reason.message}`;
        } else {
          reason = typeof event.reason === 'string'
            ? event.reason
            : JSON.stringify(event.reason);
        }
      } catch {
        reason = 'Unknown rejection';
      }
      this._capture('error', [`Unhandled Promise rejection: ${reason}`]);
    });
  }

  _capture(type, args) {
    // Respect log level threshold
    if (this.levelOrder.indexOf(type) < this.levelOrder.indexOf(this.settings.logLevel)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const key = `${type}:${this._safeStringify(args)}`;

    // Group repeated logs
    if (this.logMap.has(key)) {
      const entry = this.logMap.get(key);
      entry.count += 1;
      entry.timestamp = timestamp;
      if (entry.toasty) this._updateToastyCount(entry.toasty, entry.count);
    } else {
      const entry = { type, args, timestamp, count: 1, toasty: null };
      this.logs.push(entry);
      this._enforceMaxLogs();
      this._saveLogs();
      // Toasty display
      if (this.settings.showToasties) {
        entry.toasty = this._showToasty(entry);
      }
      this.logMap.set(key, entry);
    }

    // Live update modal if open
    this._renderLogModalContent();
  }

  // =========================
  // Toasties
  // =========================
  _ensureContainers() {
    // Toasty container
    this.toastyContainer = document.querySelector('.log-toasty-container');
    if (!this.toastyContainer) {
      this.toastyContainer = document.createElement('div');
      this.toastyContainer.className = 'log-toasty-container';
      document.body.appendChild(this.toastyContainer);
    }
  }

  _showToasty(entry) {
    const toast = document.createElement('div');
    toast.className = `log-toasty ${entry.type}`;

    const title = document.createElement('strong');
    title.textContent = entry.type.toUpperCase();

    const msg = document.createElement('span');
    msg.className = 'log-message';
    msg.textContent = `: ${this._formatArgs(entry.args)}`;

    const count = document.createElement('span');
    count.className = 'log-count';
    count.textContent = `×${entry.count}`;

    const openBtn = document.createElement('button');
    openBtn.className = 'open-log';
    openBtn.textContent = 'Open log';
    openBtn.addEventListener('click', () => this.showLogModal());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-log';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => toast.remove());

    toast.appendChild(title);
    toast.appendChild(msg);
    toast.appendChild(count);
    toast.appendChild(openBtn);
    toast.appendChild(closeBtn);

    this.toastyContainer.appendChild(toast);

    if (this.settings.autoDismiss) {
      const timeout = Math.max(500, Number(this.settings.dismissTime) || 5000);
      setTimeout(() => toast.remove(), timeout);
    }

    return toast;
  }

  _updateToastyCount(toastyEl, count) {
    if (!toastyEl) return;
    const badge = toastyEl.querySelector('.log-count');
    if (badge) badge.textContent = `×${count}`;
  }

  // =========================
  // Modals (Settings + Log Viewer)
  // =========================
  _createSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'log-settings-modal';

    const header = document.createElement('h3');
    header.textContent = 'Log Capture Settings';

    // Capture toggles
    const captureWrap = document.createElement('div');
    captureWrap.className = 'settings-section';
    const capTitle = document.createElement('h4');
    capTitle.textContent = 'Capture Types';
    captureWrap.appendChild(capTitle);

    ['error', 'warn', 'log', 'info'].forEach(type => {
      captureWrap.appendChild(this._settingCheckbox(
        `Capture ${type}`,
        this.settings.capture[type],
        checked => {
          this.settings.capture[type] = checked;
          this._saveSettings();
        }
      ));
    });

    // Toasties + auto-dismiss
    const toastyWrap = document.createElement('div');
    toastyWrap.className = 'settings-section';
    const toastyTitle = document.createElement('h4');
    toastyTitle.textContent = 'Toasties';
    toastyWrap.appendChild(toastyTitle);

    toastyWrap.appendChild(this._settingCheckbox(
      'Show toasties',
      this.settings.showToasties,
      checked => { this.settings.showToasties = checked; this._saveSettings(); }
    ));

    toastyWrap.appendChild(this._settingCheckbox(
      'Auto-dismiss toasties',
      this.settings.autoDismiss,
      checked => { this.settings.autoDismiss = checked; this._saveSettings(); }
    ));

    toastyWrap.appendChild(this._settingNumber(
      'Dismiss time (ms)',
      this.settings.dismissTime,
      value => { this.settings.dismissTime = value; this._saveSettings(); }
    ));

    // Log level
    const levelWrap = document.createElement('div');
    levelWrap.className = 'settings-section';
    const levelTitle = document.createElement('h4');
    levelTitle.textContent = 'Verbosity';
    levelWrap.appendChild(levelTitle);

    levelWrap.appendChild(this._settingSelect(
      'Log level threshold',
      ['info', 'log', 'warn', 'error'],
      this.settings.logLevel,
      value => { this.settings.logLevel = value; this._saveSettings(); }
    ));

    // Persistence
    const persistWrap = document.createElement('div');
    persistWrap.className = 'settings-section';
    const persistTitle = document.createElement('h4');
    persistTitle.textContent = 'Persistence';
    persistWrap.appendChild(persistTitle);

    persistWrap.appendChild(this._settingCheckbox(
      'Persist logs across reloads',
      this.settings.persistLogs,
      checked => {
        this.settings.persistLogs = checked;
        this._saveSettings();
        if (!checked) {
          // Clear persisted records but keep in-memory
          localStorage.removeItem('logCaptureRecords');
        } else {
          this._saveLogs();
        }
      }
    ));

    persistWrap.appendChild(this._settingNumber(
      'Max persisted logs',
      this.settings.maxLogs,
      value => {
        this.settings.maxLogs = value;
        this._saveSettings();
        this._enforceMaxLogs();
        this._saveLogs();
      }
    ));

    // Actions
    const actions = document.createElement('div');
    actions.className = 'settings-actions';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export logs (.json)';
    exportBtn.addEventListener('click', () => this._exportLogs());

    const openLogBtn = document.createElement('button');
    openLogBtn.textContent = 'Open full log';
    openLogBtn.addEventListener('click', () => {
      modal.remove();
      this.settingsModalEl = null;
      this.showLogModal()
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      modal.remove();
      this.settingsModalEl = null;
    });

    actions.appendChild(exportBtn);
    actions.appendChild(openLogBtn);
    actions.appendChild(closeBtn);

    // Assemble
    modal.appendChild(header);
    modal.appendChild(captureWrap);
    modal.appendChild(toastyWrap);
    modal.appendChild(levelWrap);
    modal.appendChild(persistWrap);
    modal.appendChild(actions);

    return modal;
  }

  _createLogModal() {
    const modal = document.createElement('div');
    modal.className = 'log-full-modal';

    const header = document.createElement('h3');
    header.textContent = 'Captured Logs';

    const controls = document.createElement('div');
    controls.className = 'log-controls';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear logs';
    clearBtn.addEventListener('click', () => this.clearLogs());

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export (.json)';
    exportBtn.addEventListener('click', () => this._exportLogs());

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.hideLogModal());

    controls.appendChild(clearBtn);
    controls.appendChild(exportBtn);
    controls.appendChild(closeBtn);

    const pre = document.createElement('pre');
    pre.className = 'log-content';

    modal.appendChild(header);
    modal.appendChild(controls);
    modal.appendChild(pre);

    modal.style.display = 'none';
    return modal;
  }

  _renderLogModalContent() {
    if (!this.logModalEl) return;
    const pre = this.logModalEl.querySelector('.log-content');
    if (!pre) return;
    pre.textContent = JSON.stringify(this.logs, null, 2);
  }

  // =========================
  // Settings Helpers
  // =========================
  _settingCheckbox(label, checked, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'setting-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = ` ${label}`;
    wrap.appendChild(input);
    wrap.appendChild(text);
    return wrap;
  }

  _settingNumber(label, value, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'setting-item';
    const text = document.createElement('span');
    text.textContent = ` ${label}: `;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = Number(value) || 0;
    input.min = '0';
    input.addEventListener('change', () => onChange(Number(input.value)));
    wrap.appendChild(text);
    wrap.appendChild(input);
    return wrap;
  }

  _settingSelect(label, options, current, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'setting-item';
    const text = document.createElement('span');
    text.textContent = ` ${label}: `;
    const select = document.createElement('select');
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === current) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(text);
    wrap.appendChild(select);
    return wrap;
  }

  // =========================
  // Persistence
  // =========================
  _loadSettings() {
    try {
      return JSON.parse(localStorage.getItem('logCaptureSettings')) || {};
    } catch {
      return {};
    }
  }

  _saveSettings() {
    try {
      localStorage.setItem('logCaptureSettings', JSON.stringify(this.settings));
    } catch {
      // ignore
    }
  }

  _loadLogs() {
    try {
      return JSON.parse(localStorage.getItem('logCaptureRecords')) || [];
    } catch {
      return [];
    }
  }

  _saveLogs() {
    if (!this.settings.persistLogs) return;
    try {
      localStorage.setItem('logCaptureRecords', JSON.stringify(this.logs.slice(-this.settings.maxLogs)));
    } catch {
      // ignore
    }
  }

  _enforceMaxLogs() {
    const limit = Math.max(0, Number(this.settings.maxLogs) || 0);
    if (limit === 0) return; // 0 => no limit
    if (this.logs.length > limit) {
      const removeCount = this.logs.length - limit;
      // Remove oldest from array
      this.logs.splice(0, removeCount);
      // Rebuild map to ensure grouped counts remain accurate for retained entries
      this._rebuildLogMapFromArray();
    }
  }

  _rebuildLogMapFromArray() {
    this.logMap.clear();
    for (const entry of this.logs) {
      const key = `${entry.type}:${this._safeStringify(entry.args)}`;
      this.logMap.set(key, entry);
    }
  }

  _exportLogs() {
    const blob = new Blob([JSON.stringify(this.logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logs.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // =========================
  // Utilities
  // =========================
  _safeStringify(args) {
    try {
      return JSON.stringify(args, (key, value) => {
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack };
        }
        if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
        if (value === undefined) return '[undefined]';
        return value;
      });
    } catch {
      return '[unstringifiable]';
    }
  }

  _formatArgs(args) {
    return args.map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return '[Object]'; }
      }
      if (typeof a === 'function') return `[Function ${a.name || 'anonymous'}]`;
      if (a === undefined) return 'undefined';
      return String(a);
    }).join(' ');
  }

  _mergeDeep(target, ...sources) {
    for (const src of sources) {
      if (!src || typeof src !== 'object') continue;
      for (const key of Object.keys(src)) {
        const val = src[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          target[key] = this._mergeDeep({ ...(target[key] || {}) }, val);
        } else {
          target[key] = val;
        }
      }
    }
    return target;
  }

  _injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
      .log-toasty-container {
        position: fixed;
        bottom: 10px;
        right: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 2147483647; /* top-most */
        pointer-events: none;
      }
      .log-toasty {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: 60vw;
        background: #333;
        color: #fff;
        padding: 10px 12px;
        border-radius: 6px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        font-size: 13px;
      }
      .log-toasty.error { background: #c0392b; }
      .log-toasty.warn  { background: #e6b800; color: #000; }
      .log-toasty.info  { background: #2c3e50; }
      .log-toasty .log-count {
        background: #fff;
        color: #000;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 12px;
        line-height: 1;
      }
      .log-toasty .open-log,
      .log-toasty .close-log {
        background: rgba(255,255,255,0.2);
        color: inherit;
        border: none;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
      }
      .log-toasty .close-log { font-weight: bold; }

      .log-settings-modal, .log-full-modal {
        position: fixed;
        top: 12%;
        left: 50%;
        transform: translateX(-50%);
        min-width: 320px;
        max-width: 80vw;
        background: #fff;
        color: #222;
        padding: 16px;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: 0 6px 30px rgba(0,0,0,0.25);
        z-index: 2147483646;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .log-settings-modal h3,
      .log-full-modal h3 { margin: 0 0 12px; font-size: 16px; }
      .settings-section { margin: 10px 0 12px; }
      .settings-section h4 { margin: 0 0 8px; font-size: 14px; }
      .setting-item { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .settings-actions { display: flex; gap: 8px; margin-top: 12px; }
      .log-full-modal .log-controls { display: flex; gap: 8px; margin-bottom: 12px; }
      .log-full-modal .log-content {
        max-height: 50vh;
        overflow: auto;
        background: #f7f7f7;
        padding: 10px;
        border-radius: 6px;
        border: 1px solid #eee;
      }
      .log-settings-modal button,
      .log-full-modal button {
        background: #2b7cff;
        color: #fff;
        border: none;
        padding: 8px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .log-settings-modal button:hover,
      .log-full-modal button:hover { filter: brightness(0.95); }
    `;
    document.head.appendChild(style);
  }
}

// Optional: auto-expose globally
//window.LogCapture = LogCapture;

/* Example inline init:
   const lc = new LogCapture({ settingsButtonSelector: '#log-settings-button' });
*/
