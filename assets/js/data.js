(function (global) {
  function DataLib(initialData = [], options = {}) {
    // -------------------------------
    // Internal state
    // -------------------------------
    let state = {
      globalFilter: false,
      filters: [],
      sort: [],
      page: 1,
      rowsPerPage: 10,
      columns: [],
      columnMeta: {},
      classes: {
        table: 'dl-table',
        thead: 'dl-thead',
        th: 'dl-th',
        tbody: 'dl-tbody',
        tr: 'dl-tr',
        td: 'dl-td',
        cardsContainer: 'dl-cards',
        card: 'dl-card',
        cardField: 'dl-card-field',
        cardLabel: 'dl-card-label',
        cardValue: 'dl-card-value',
        pagination: 'dl-pagination',
        pageBtn: 'dl-page',
        active: 'dl-active',
        ellipsis: 'dl-ellipsis',
        rowsPerPage: 'dl-rows-per-page'
      },
      domSelectors: {
        table: null,           // e.g. '#table-container'
        cards: null,          // e.g. '#cards-container'
        pagination: null,      // e.g. '#pagination-container'
        filters: null,         // e.g. '#filter-container'    
        detail: null//'#detail-container'

      },
      uniqueKey: null,         // e.g. 'id'
      persistKey: null,         // e.g. 'DataLibState'
      ...options
    };

    let dataset = Array.isArray(initialData) ? initialData.slice() : [];

    // -------------------------------
    // Helpers
    // -------------------------------
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    function escapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function inferColumnsFromData(data) {
      const set = new Set();
      for (const row of data || []) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          Object.keys(row).forEach(k => set.add(k));
        }
      }
      return Array.from(set);
    }

    function prettifyLabel(key) {
      return String(key)
        .replaceAll('_', ' ')
        .replaceAll('-', ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
    }

    function resolveColumns(data, columns, columnMeta = {}) {
      let cols = Array.isArray(columns) && columns.length
        ? columns.slice()
        : inferColumnsFromData(data);
      cols = cols.map(col => {
        if (typeof col === 'string') {
          const meta = columnMeta[col] || {};
          return {
            concat: meta.concat || null,
            sep: meta.sep || null,
            key: col,
            label: meta.label || prettifyLabel(col),
            type: meta.type || 'text',
            format: meta.format || null,
            formatOptions: meta.formatOptions || {}
          };
        }
        const meta = columnMeta[col.key] || {};
        return {
          sep: col.sep || meta.sep || null,
          concat: col.concat || meta.concat || null,
          key: col.key,
          label: col.label || meta.label || prettifyLabel(col.key),
          type: col.type || meta.type || 'text',
          format: col.format || meta.format || null,
          formatOptions: col.formatOptions || meta.formatOptions || {}
        };
      });
      return cols;
    }

    // -------------------------------
    // Persistence
    // -------------------------------
    const Persist = {
      save(key, value) {
        if (!isBrowser || !key) return;
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
      },
      load(key) {
        if (!isBrowser || !key) return null;
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch { return null; }
      }
    };

    // Load persisted state if configured
    if (state.persistKey) {
      const saved = Persist.load(state.persistKey);
      if (saved && typeof saved === 'object') {
        // only merge safe keys
        const { filters, sort, page, rowsPerPage } = saved;
        state.filters = Array.isArray(filters) ? filters : state.filters;
        state.sort = Array.isArray(sort) ? sort : state.sort;
        state.page = Number.isFinite(page) ? page : state.page;
        state.rowsPerPage = Number.isFinite(rowsPerPage) ? rowsPerPage : state.rowsPerPage;
      }
    }

    function persistState() {
      if (state.persistKey) {
        Persist.save(state.persistKey, {
          filters: state.filters,
          sort: state.sort,
          page: state.page,
          rowsPerPage: state.rowsPerPage
        });
      }
    }

    // -------------------------------
    // Core data engine
    // -------------------------------
    const DataEngine = {
      _get(obj, path) {
        if (obj == null || !path) return undefined;
        if (path in obj) return obj[path];
        if (typeof path === 'string' && path.includes('.')) {
          return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
        }
        return obj[path];
      },
      _toComparable(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        if (v instanceof Date) return v.getTime();
        const n = Number(v);
        if (!Number.isNaN(n) && v !== '') return n;
        const t = Date.parse(v);
        if (!Number.isNaN(t)) return t;
        return String(v).toLowerCase();
      },
      _compare(a, b) {
        const ca = DataEngine._toComparable(a);
        const cb = DataEngine._toComparable(b);
        if (ca === null && cb === null) return 0;
        if (ca === null) return -1;
        if (cb === null) return 1;
        return ca < cb ? -1 : (ca > cb ? 1 : 0);
      },
      _contains(v, a) {
        if (v === null || v === undefined) return false;
        const s = String(v).toLowerCase();
        const q = String(a).toLowerCase();
        return s.includes(q);
      },
      filter(arr, filters) {
        if (!filters || !filters.length) return arr.slice();
        return arr.filter(row =>
          filters.every(f => {
            const op = f.op || 'equals';

            // multi-column match: anyof
            if (op === 'anyof') {
              const keys = Array.isArray(f.keys) ? f.keys : [];
              return keys.some(k => DataEngine._contains(DataEngine._get(row, k), f.value));
            }
            // global contains across all columns: containsany
            if (op === 'containsany') {
              return Object.values(row).some(v => DataEngine._contains(v, f.value));
            }

            const val = DataEngine._get(row, f.key);
            switch (op) {
              case 'equals': return DataEngine._toComparable(val) === DataEngine._toComparable(f.value);
              case 'notequals': return DataEngine._toComparable(val) !== DataEngine._toComparable(f.value);
              case 'contains': return DataEngine._contains(val, f.value);
              case 'notcontains': return !DataEngine._contains(val, f.value);
              case 'startswith': return String(val ?? '').toLowerCase().startsWith(String(f.value ?? '').toLowerCase());
              case 'endswith': return String(val ?? '').toLowerCase().endsWith(String(f.value ?? '').toLowerCase());
              case '>': return DataEngine._compare(val, f.value) > 0;
              case '>=': return DataEngine._compare(val, f.value) >= 0;
              case '<': return DataEngine._compare(val, f.value) < 0;
              case '<=': return DataEngine._compare(val, f.value) <= 0;
              case 'between': {
                const [min, max] = Array.isArray(f.value) ? f.value : [f.value, f.value];
                return DataEngine._compare(val, min) >= 0 && DataEngine._compare(val, max) <= 0;
              }
              case 'in': return Array.isArray(f.value) && f.value.some(x => DataEngine._toComparable(val) === DataEngine._toComparable(x));
              case 'notin': return Array.isArray(f.value) && !f.value.some(x => DataEngine._toComparable(val) === DataEngine._toComparable(x));
              case 'isnull': return val === null || val === undefined;
              case 'notnull': return !(val === null || val === undefined);
              default: return true;
            }
          })
        );
      },
      sort(arr, sortKeys) {
        if (!sortKeys || !sortKeys.length) return arr.slice();
        const keys = sortKeys.map(s => ({
          key: s.key,
          dir: (s.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1,
          nulls: s.nulls || 'last',
          primer: s.primer || null
        }));
        const cmp = (a, b) => {
          for (const k of keys) {
            let va = DataEngine._get(a, k.key);
            let vb = DataEngine._get(b, k.key);
            if (k.primer) { va = k.primer(va); vb = k.primer(vb); }
            const na = va === null || va === undefined;
            const nb = vb === null || vb === undefined;
            if (na || nb) {
              if (na && nb) continue;
              return (na ? (k.nulls === 'first' ? -1 : 1) : (k.nulls === 'first' ? 1 : -1));
            }
            const c = DataEngine._compare(va, vb);
            if (c !== 0) return c * k.dir;
          }
          return 0;
        };
        return arr.slice().sort(cmp);
      },
      paginate(arr, page, rows) {
        const total = arr.length;
        const per = Math.max(1, Number(rows) || 10);
        const p = Math.max(1, Number(page) || 1);
        const start = (p - 1) * per;
        const end = Math.min(start + per, total);
        return {
          page: p,
          rowsPerPage: per,
          total,
          totalPages: Math.max(1, Math.ceil(total / per)),
          rows: arr.slice(start, end)
        };
      },
      groupBy(arr, key, aggregations = {}) {
        const groups = new Map();
        for (const row of arr) {
          const g = DataEngine._get(row, key);
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(row);
        }
        const aggFn = (values, op) => {
          if (typeof op === 'function') return op(values);
          switch (op) {
            case 'count': return values.length;
            case 'sum': return values.reduce((a, v) => a + (Number(v) || 0), 0);
            case 'avg': {
              const nums = values.map(v => Number(v)).filter(v => !Number.isNaN(v));
              return nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : 0;
            }
            case 'min': return values.reduce((m, v) => (m === null || DataEngine._compare(v, m) < 0 ? v : m), null);
            case 'max': return values.reduce((m, v) => (m === null || DataEngine._compare(v, m) > 0 ? v : m), null);
            default: return null;
          }
        };
        const out = [];
        for (const [gkey, rows] of groups.entries()) {
          const entry = { group: gkey, rows };
          for (const [field, op] of Object.entries(aggregations)) {
            const vals = rows.map(r => DataEngine._get(r, field));
            entry[field] = aggFn(vals, op);
          }
          out.push(entry);
        }
        return out;
      },
      join(arrays, keyMatrix) {
        // arrays: [data1, data2, ...]
        // keyMatrix: [[k1a,k1b,...],[k2a,k2b,...], ...] keys to match per array index
        if (!Array.isArray(arrays) || arrays.length === 0) return [];
        return arrays.reduce((acc, arr, idx) => {
          if (idx === 0) return arr.slice();
          const keys = Array.isArray(keyMatrix[idx]) ? keyMatrix[idx] : Array.isArray(keyMatrix) ? keyMatrix : [];
          const index = new Map();
          for (const r of arr) {
            const keyVal = keys.map(k => DataEngine._get(r, k)).join('|');
            const list = index.get(keyVal) || [];
            list.push(r);
            index.set(keyVal, list);
          }
          const merged = [];
          for (const base of acc) {
            const baseKey = keys.map(k => DataEngine._get(base, k)).join('|');
            const matches = index.get(baseKey);
            if (matches && matches.length) {
              for (const m of matches) merged.push({ ...base, ...m });
            } else {
              merged.push({ ...base });
            }
          }
          return merged;
        }, arrays[0] || []);
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      countOccurrences(arr, key) {
        const map = new Map();
        for (const row of arr) {
          const v = key ? DataEngine._get(row, key) : row;
          map.set(v, (map.get(v) || 0) + 1);
        }
        return Object.fromEntries(map.entries());
      },
      cleanObject(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
          return obj
            .map(DataEngine.cleanObject)
            .filter(v => !(v === null || v === undefined || v === '' || (typeof v === 'object' && Object.keys(v).length === 0)));
        }
        return Object.entries(obj).reduce((acc, [key, value]) => {
          const cleaned = DataEngine.cleanObject(value);
          const isEmptyObject = typeof cleaned === 'object' && cleaned !== null && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0;
          const isEmptyArray = Array.isArray(cleaned) && cleaned.length === 0;
          if (cleaned !== null && cleaned !== undefined && cleaned !== '' && !isEmptyObject && !isEmptyArray) {
            acc[key] = cleaned;
          }
          return acc;
        }, {});
      },
      uniqueFromKey(arr, key) {
        const keys = Array.isArray(key) ? key : [key];
        let results = [];
        keys.forEach(k => {
          results.push(...Array.from(new Set(arr.map(row => row[k]).filter(v => v !== null && v !== undefined))));
        });
        return Array.from(new Set(results)).sort();
        //
        //return Array.from(new Set(arr.map(row => row[key]).filter(v => v !== null && v !== undefined))).sort();
      }
    };

    // -------------------------------
    // Formatter registry
    // -------------------------------
    const FormatterRegistry = {
      registry: {
        text: v => (v == null ? '' : escapeHtml(String(v))),
        number: (v, { decimals = null } = {}) => {
          const n = Number(v);
          if (Number.isNaN(n)) return '';
          return decimals == null ? escapeHtml(String(n)) : escapeHtml(n.toFixed(decimals));
        },
        email: v => v ? `<a href="mailto:${escapeHtml(String(v))}">${escapeHtml(String(v))}</a>` : '',
        url: (v, { label = null, target = '_blank' } = {}) => {
          if (!v) return '';
          const text = label || String(v);
          return `<a href="${escapeHtml(String(v))}" target="${escapeHtml(target)}" rel="noopener">${escapeHtml(text)}</a>`;
        },
        image: (v, { alt = '', width = null, height = null } = {}) => {
          if (!v) return '';
          const w = width ? ` width="${Number(width)}"` : '';
          const h = height ? ` height="${Number(height)}"` : '';
          return `<img src="${escapeHtml(String(v))}" alt="${escapeHtml(String(alt))}"${w}${h}>`;
        },
        date: (v, { locale = undefined, options = {} } = {}) => {
          const d = v instanceof Date ? v : (typeof v === 'string' || typeof v === 'number') ? new Date(v) : null;
          return d && !Number.isNaN(d.getTime()) ? escapeHtml(d.toLocaleDateString(locale, options)) : '';
        },
        time: (v, { locale = undefined, options = {} } = {}) => {
          const d = v instanceof Date ? v : (typeof v === 'string' || typeof v === 'number') ? new Date(v) : null;
          return d && !Number.isNaN(d.getTime()) ? escapeHtml(d.toLocaleTimeString(locale, options)) : '';
        },
        datetime: (v, { locale = undefined, options = {} } = {}) => {
          const d = v instanceof Date ? v : (typeof v === 'string' || typeof v === 'number') ? new Date(v) : null;
          return d && !Number.isNaN(d.getTime()) ? escapeHtml(d.toLocaleString(locale, options)) : '';
        },
        json: v => escapeHtml(JSON.stringify(v, null, 2)),
        list: (v, { sep = ', ' } = {}) => Array.isArray(v) ? v.map(x => escapeHtml(String(x))).join(sep) : escapeHtml(String(v))
      },
      format(value, type = 'text', options = {}) {
        const fn = FormatterRegistry.registry[type] || FormatterRegistry.registry.text;
        return fn(value, options);
      },
      register(type, fn) {
        FormatterRegistry.registry[type] = fn;
      }
    };

    // -------------------------------
    // Storage with expiry
    // -------------------------------
    function safeStorage() {
      if (!isBrowser) return false;
      try {
        const k = '__dl_test__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch { return false; }
    }

    const Storage = {
      set(key, value, expirySecs = null) {
        if (!safeStorage()) return false;
        const record = { value, expiry: expirySecs ? Date.now() + expirySecs * 1000 : null };
        localStorage.setItem(key, JSON.stringify(record));
        return true;
      },
      get(key) {
        if (!safeStorage()) return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          const record = JSON.parse(raw);
          if (record.expiry && Date.now() > record.expiry) {
            localStorage.removeItem(key);
            return null;
          }
          return record.value;
        } catch { return null; }
      },
      delete(key) {
        if (!safeStorage()) return false;
        localStorage.removeItem(key);
        return true;
      }
    };

    // -------------------------------
    // IO: fetch + CSV
    // -------------------------------
    const IO = {
      async fetchData(url, { type = 'json', cacheKey = null, expiry = null, fetchOptions = {} } = {}) {
        if (cacheKey) {
          const cached = Storage.get(cacheKey);
          if (cached !== null) return cached;
        }
        const res = await fetch(url, { method: 'GET', ...fetchOptions });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        let parsed;
        switch (String(type).toLowerCase()) {
          case 'json': parsed = await res.json(); break;
          case 'text': parsed = await res.text(); break;
          case 'csv': {
            const txt = await res.text();
            parsed = IO.parseCSV(txt);
            break;
          }
          default: parsed = await res.text(); break;
        }
        if (cacheKey) Storage.set(cacheKey, parsed, expiry);
        return parsed;
      },
      parseCSV(csvString, { header = true, delimiter = ',', quote = '"' } = {}) {
        const rows = [];
        let i = 0, field = '', inQuotes = false, row = [];
        const s = String(csvString);

        const pushField = () => { row.push(field); field = ''; };
        const pushRow = () => { rows.push(row); row = []; };

        while (i < s.length) {
          const ch = s[i];

          if (inQuotes) {
            if (ch === quote) {
              const next = s[i + 1];
              if (next === quote) { field += quote; i += 2; continue; }
              inQuotes = false; i++; continue;
            } else { field += ch; i++; continue; }
          } else {
            if (ch === quote) { inQuotes = true; i++; continue; }
            if (ch === delimiter) { pushField(); i++; continue; }
            if (ch === '\n') { pushField(); pushRow(); i++; continue; }
            if (ch === '\r') { if (s[i + 1] === '\n') i++; pushField(); pushRow(); i++; continue; }
            field += ch; i++;
          }
        }
        pushField();
        pushRow();

        if (!header) return rows;
        const [hdr, ...dataRows] = rows;
        return dataRows.map(r => {
          const obj = {};
          for (let j = 0; j < hdr.length; j++) obj[hdr[j]] = r[j] ?? '';
          return obj;
        });
      },
      toCSV(data, { delimiter = ',', quote = '"', header = true } = {}) {
        if (!Array.isArray(data) || data.length === 0) return '';
        const isObjArray = typeof data[0] === 'object' && !Array.isArray(data[0]);
        let headers = [];

        if (isObjArray) {
          const keySet = new Set();
          data.forEach(row => Object.keys(row).forEach(k => keySet.add(k)));
          headers = Array.from(keySet);
        }

        const esc = val => {
          const s = val === null || val === undefined ? '' : String(val);
          const mustQuote = s.includes(delimiter) || s.includes('\n') || s.includes('\r') || s.includes(quote);
          const q = s.replaceAll(quote, quote + quote);
          return mustQuote ? `${quote}${q}${quote}` : q;
        };

        const lines = [];
        if (header && isObjArray) {
          lines.push(headers.map(esc).join(delimiter));
          data.forEach(row => {
            lines.push(headers.map(h => esc(row[h])).join(delimiter));
          });
        } else if (Array.isArray(data[0])) {
          data.forEach(arr => { lines.push(arr.map(esc).join(delimiter)); });
        } else {
          data.forEach(v => lines.push(esc(v)));
        }
        return lines.join('\r\n');
      }
    };

    function wireSortingInteractions(tableSel) {
      const container = document.querySelector(tableSel);
      if (!container) return;

      container.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-sort');
          // Toggle sort direction
          const current = state.sort.find(s => s.key === key);
          let dir = 'asc';
          if (current && current.dir === 'asc') dir = 'desc';
          state.sort = [{ key, dir }];
          state.page = 1; // reset to first page
          persistState();

          api.renderTable({ mount: state.domSelectors.table });
          api.renderPagination({ mount: state.domSelectors.pagination });
        });
      });
    }
    function wireDetailInteractions(tableSel, detailMountSel, detailKey = 'id') {
      const container = document.querySelector(tableSel);
      if (!container) return;

      container.querySelectorAll('.dl-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          if (id && detailMountSel) {
            api.renderDetailById(id, detailKey, {
              mode: 'card',
              mount: detailMountSel
            });
          }
        });
      });
    }

    // -------------------------------
    // Renderers (HTML string; optional DOM injection)
    // -------------------------------
    const Renderers = {
      table(arr, opts = {}) {
        const classes = opts.classes || state.classes;
        const cols = resolveColumns(arr, opts.columns, opts.columnMeta);

        const sel = opts.mount || state.domSelectors.table;
        // Build table header with sortable columns
        const thead = `<thead class="${escapeHtml(classes.thead)}"><tr class="${escapeHtml(classes.tr)}">${cols.map(c => {
          const sortAttr = `data-sort="${escapeHtml(c.key)}"`;
          return `<th class="${escapeHtml(classes.th)}" ${sortAttr}>${escapeHtml(c.label)}</th>`;
        }).join('')
          }</tr></thead>`;
        const detailKey = state.uniqueKey || 'id';

        // Build table body
        const tbody = `<tbody class="${escapeHtml(classes.tbody)}">${arr.map((row) => {
          const tds = cols.map(c => {
            const raw = DataEngine._get(row, c.key);
            const formatted = c.concat
              ? escapeHtml(concatKeys(row, c.concat, c.sep || ' '))
              : c.render
                ? c.render(raw, row)
                : c.format
                  ? c.format(raw, c.formatOptions || {})
                  : FormatterRegistry.format(raw, c.type || 'text', c.formatOptions || {});
            //const formatted = c.render
            //  ? c.render(raw, row)
            //  : c.format
            //    ? c.format(raw, c.formatOptions || {})
            //    : FormatterRegistry.format(raw, c.type || 'text', c.formatOptions || {});
            return `<td class="${escapeHtml(classes.td)}">${formatted}</td>`;
          }).join('');

          // Optional detail button  
          const id = DataEngine._get(row, detailKey);

          //const id = row.id ?? row._id ?? row.uuid;
          const detailBtn = id != null && state.domSelectors.detail !== sel
            ? `<td class="${escapeHtml(classes.td)}"><button class="dl-detail-btn" data-id="${escapeHtml(id)}">View</button></td>`
            : '';

          return `<tr class="${escapeHtml(classes.tr)}">${tds}${detailBtn}</tr>`;
        }).join('')
          }</tbody>`;

        const html = `<table class="${escapeHtml(classes.table)}">${thead}${tbody}</table>`;

        // Optional DOM mount
        if (opts.mount || state.domSelectors.table) {
          if (mountHTML(sel, html)) {
            wireSortingInteractions(sel);
            wireDetailInteractions(sel, state.domSelectors.detail, detailKey);
          }
        }

        return html;

      },
      cards(arr, opts) {
        const detailKey = state.uniqueKey || 'id';
        const sel = opts.mount || state.domSelectors.cards;
        const classes = opts.classes || state.classes;
        const cols = resolveColumns(arr, opts.columns, opts.columnMeta);
        const cards = arr.map(row => {
          const fields = cols.map(c => {
            const raw = DataEngine._get(row, c.key);
            const formatted = c.concat
              ? escapeHtml(concatKeys(row, c.concat, c.sep || ' '))
              : c.render
                ? c.render(raw, row)
                : c.format
                  ? c.format(raw, c.formatOptions || {})
                  : FormatterRegistry.format(raw, c.type || 'text', c.formatOptions || {});

            //const formatted = c.format
            // ? c.format(raw, c.formatOptions || {})
            // : FormatterRegistry.format(raw, c.type || 'text', c.formatOptions || {});
            return `<div class="${escapeHtml(classes.cardField)}"><span class="${escapeHtml(classes.cardLabel)}">${escapeHtml(c.label)}:</span> <span class="${escapeHtml(classes.cardValue)}">${formatted}</span></div>`;
          }).join('');
          const id = DataEngine._get(row, detailKey);
          const detailBtn = id != null && state.domSelectors.detail !== sel
            ? `<button class="dl-detail-btn" data-id="${escapeHtml(id)}">View</button>`
            : '';
          return `<div class="${escapeHtml(classes.card)}">${fields}${detailBtn}</div>`;
        }).join('');
        const html = `<div class="${escapeHtml(classes.cardsContainer)}">${cards}</div>`;
        if (opts.mount || state.domSelectors.cards) {
          if (mountHTML(sel, html)) {
            wireDetailInteractions(sel, state.domSelectors.detail, detailKey);
          }
        }
        return html;
      },
      pagination({ page = 1, rowsPerPage = 10, total = 0, window = 3, classes = state.classes } = {}) {
        const totalPages = Math.max(1, Math.ceil(total / Math.max(1, rowsPerPage)));
        const start = Math.max(1, page - window);
        const end = Math.min(totalPages, page + window);

        const pages = [];
        if (start > 1) pages.push(1, '…');
        for (let p = start; p <= end; p++) pages.push(p);
        if (end < totalPages) pages.push('…', totalPages);

        const items = pages.map(p => {
          if (p === '…') return `<span class="${escapeHtml(classes.ellipsis)}">…</span>`;
          const cls = p === page ? `${classes.pageBtn} ${classes.active}` : classes.pageBtn;
          return `<button data-page="${p}" class="${escapeHtml(cls)}">${p}</button>`;
        }).join('');

        // Rows-per-page selector
        const rpp = [5, 10, 25, 50, 100].map(n => {
          const selected = Number(rowsPerPage) === n ? ' selected' : '';
          return `<option value="${n}"${selected}>${n}</option>`;
        }).join('');

        return `<div class="${escapeHtml(classes.pagination)}">
          <label class="${escapeHtml(classes.rowsPerPage)}">Rows per page:
            <select data-rows-per-page>${rpp}</select>
          </label>
          ${items}
        </div>`;
      }
    };

    // -------------------------------
    // Effective pipeline
    // -------------------------------
    function effectiveData(opts = {}, { raw = false } = {}) {
      const local = { ...state, ...opts };
      let out = dataset.slice();
      if (Array.isArray(local.filters) && local.filters.length) out = DataEngine.filter(out, local.filters);
      if (Array.isArray(local.sort) && local.sort.length) out = DataEngine.sort(out, local.sort);
      if (!raw) return DataEngine.paginate(out, local.page, local.rowsPerPage).rows;
      return out;
    }

    function effectiveStats(opts = {}) {
      const local = { ...state, ...opts };
      const full = effectiveData(local, { raw: true });
      const pg = DataEngine.paginate(full, local.page, local.rowsPerPage);
      return { total: pg.total, totalPages: pg.totalPages, page: pg.page, rowsPerPage: pg.rowsPerPage };
    }

    function mountHTML(selector, html) {
      if (!isBrowser || !selector) return false;
      const el = document.querySelector(selector);
      if (!el) return false;
      el.innerHTML = html;
      return true;
    }

    function wirePaginationInteractions(containerSel) {
      if (!isBrowser || !containerSel) return;
      const container = document.querySelector(containerSel);
      if (!container) return;

      container.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = Number(btn.getAttribute('data-page')) || 1;
          api.setState({ page });
          api.renderTable({ mount: state.domSelectors.table });
          api.renderPagination({ mount: state.domSelectors.pagination });
        });
      });

      const rppEl = container.querySelector('select[data-rows-per-page]');
      if (rppEl) {
        rppEl.addEventListener('change', () => {
          const rowsPerPage = Number(rppEl.value) || state.rowsPerPage;
          api.setState({ rowsPerPage, page: 1 });
          api.renderTable({ mount: state.domSelectors.table });
          api.renderPagination({ mount: state.domSelectors.pagination });
        });
      }
    }

    function generateForm(configOrOpts = {}) {
      const local = { ...state };
      const config = { ...local.columnMeta, ...configOrOpts };
      const mountSel = local.domSelectors.filters;
      const filterKeys = Object.keys(config).filter(
        key => 'filterable' in config[key]
      );
      const cols = filterKeys.length ? filterKeys.slice() : [];//inferColumnsFromData(dataset);



      if (!mountSel) return;

      const html = cols.map(key => {
        //const esc = escapeHtml(esc);
        const keyMeta = config[key] || {};
        const value = local.filters.find(f => f.key === key)?.value || '';
        const name = key;
        const label = keyMeta.filterLabel || prettifyLabel(key);
        const id = "filterID_" + escapeHtml(name);
        key = keyMeta.filterKeys || key;
        const type = keyMeta.filterType || 'text';
        const op = keyMeta.filterOp || 'equals';
        //const { name, type = 'text', label = name, options = [], value = '', multiple = false, placeholder = '', min, max, step } = input;
        //const id = name.replace(/\s+/g, '_');
        const placeholder = keyMeta.filterPlaceholder || 'Enter ' + escapeHtml(key);
        //const multiple = keyMeta.filterMultiple || false;
        const minMax = DataEngine.groupBy(dataset, key, { min: 'min', max: 'max' });
        const min = minMax.min;
        const max = minMax.max;
        const step = keyMeta.filterStep;
        // Escape HTML helper

        // Label prefix
        const lbl = `<label for="${escapeHtml(id)}">${escapeHtml(label)}:</label>`;
        const opDataTag = ` data-op="${escapeHtml(op)}"`;

        switch (type) {
          case 'select':
          case 'selectmultiple':
            const options = keyMeta.filterOptions || DataEngine.uniqueFromKey(dataset, key);
            const opts = options.map(opt => {
              const val = typeof opt === 'object' ? opt.value : opt;
              const txt = typeof opt === 'object' ? opt.label : opt;
              const selected = val == value ? ' selected' : '';
              return `<option value="${escapeHtml(val)}"${selected}>${escapeHtml(txt)}</option>`;
            }).join('');
            return `<div class="form-field">${lbl}
          <select id="${escapeHtml(id)}"${opDataTag} name="${escapeHtml(name)}"${type === 'selectmultiple' ? ' multiple' : ''}>${type === 'select' ? '<option value="">All</option>' : ''}${opts}</select>
        </div>`;

          case 'textarea':
            return `<div class="form-field">${lbl}
          <textarea id="${escapeHtml(id)}"${opDataTag} name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
        </div>`;

          case 'checkbox':
          case 'radio':
            return `<div class="form-field">
          <label><input type="${escapeHtml(type)}"${opDataTag} id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}"> ${escapeHtml(label)}</label>
        </div>`;

          case 'range':
            return `<div class="form-field">${lbl}
          <input type="range" id="${escapeHtml(id)}"${opDataTag} name="${escapeHtml(name)}" min="${escapeHtml(min ?? 0)}" max="${escapeHtml(max ?? 100)}" step="${escapeHtml(step ?? 1)}" value="${escapeHtml(value)}">
          <span class="range-value">${escapeHtml(value)}</span>
        </div>`;

          case 'date':
          case 'number':
          case 'color':
          case 'password':
          case 'email':
          case 'text':
          default:
            return `<div class="form-field">${lbl}
          <input type="${escapeHtml(type)}" id="${escapeHtml(id)}"${opDataTag} name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"
          ${min !== undefined ? `min="${escapeHtml(min)}"` : ''} ${max !== undefined ? `max="${escapeHtml(max)}"` : ''} ${step !== undefined ? `step="${escapeHtml(step)}"` : ''}>
        </div>`;
        }
      }).join('');
      if (mountHTML(mountSel, `<div class="generated-form">${html}</div>`)) {
        // Wire up range input value display
        const container = document.querySelector(mountSel);
        container.addEventListener('input', getFormValues);
        container.addEventListener('change', getFormValues);
      }
      return html;
    }
    const getFormValues = () => { //getFormValues(container) {

      const local = { ...state };
      const config = { ...local.columnMeta };
      const mountSel = local.domSelectors.filters;
      const container = document.querySelector(mountSel);
      const filters = [];
      const elements = container.querySelectorAll('input, select, textarea, [contenteditable]');

      elements.forEach(el => {
        const key = el.name || el.id || el.dataset.key;
        if (!key) return;
        const keyMeta = config[key] || {};
        keys = keyMeta.filterKeys || [];
        const op = el.dataset.op || 'equals';

        const tag = el.tagName.toLowerCase();
        const type = el.type ? el.type.toLowerCase() : '';
        let value;

        if (tag === 'select') {
          value = el.multiple
            ? Array.from(el.selectedOptions).map(opt => opt.value)
            : el.value;
        } else if (tag === 'textarea') {
          value = el.value;
        } else if (tag === 'input') {
          switch (type) {
            case 'checkbox':
              const checkboxes = container.querySelectorAll(`input[name="${key}"]`);
              value = checkboxes.length > 1
                ? Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value)
                : el.checked;
              break;
            case 'radio':
              const checked = container.querySelector(`input[name="${key}"]:checked`);
              value = checked ? checked.value : null;
              break;
            case 'number':
              value = el.value === '' ? null : Number(el.value);
              break;
            case 'range':
              value = Number(el.value);
              break;
            default:
              value = el.value;
          }
        } else if (el.isContentEditable) {
          value = el.innerText.trim();
        }
        if (value !== "" && value.length) filters.push({ key, op, value, keys });
      });
      api.setState({ filters, page: 1 });
      api.renderData();
      api.renderPagination();
      return filters;
    }

    function concatKeys(row, keys = [], sep = ' ') {
      return keys
        .map(k => DataEngine._get(row, k))
        .filter(v => v != null && v !== '')
        .join(sep);
    }
    // -------------------------------
    // Public API
    // -------------------------------
    const api = {
      // Data/state
      setData(arr) { dataset = Array.isArray(arr) ? arr.slice() : []; return api; },
      getData() { return dataset.slice(); },
      setState(newState = {}) { state = { ...state, ...newState }; persistState(); return api; },
      getState() { return JSON.parse(JSON.stringify(state)); },

      // Core operations
      filter(filters = []) { state.filters = Array.isArray(filters) ? filters : []; persistState(); return effectiveData(); },
      sort(sortKeys = []) { state.sort = Array.isArray(sortKeys) ? sortKeys : []; persistState(); return effectiveData(); },
      paginate(page = state.page, rows = state.rowsPerPage) {
        state.page = Math.max(1, Number(page) || 1);
        state.rowsPerPage = Math.max(1, Number(rows) || 10);
        persistState();
        return effectiveData();
      },
      groupBy(key, aggregations = {}) { return DataEngine.groupBy(dataset, key, aggregations); },
      join(arrays, keyMatrix) {
        const input = Array.isArray(arrays) ? arrays : [dataset, arrays];
        return DataEngine.join(input, keyMatrix || []);
      },
      shuffle() { dataset = DataEngine.shuffle(dataset); return dataset.slice(); },
      countOccurrences(key) { return DataEngine.countOccurrences(dataset, key); },
      compare(a, b) { return DataEngine._compare(a, b); },

      // Columns/meta
      setColumns(columns = []) { state.columns = Array.isArray(columns) ? columns.slice() : []; return state.columns; },
      setColumnMeta(key, meta = {}) {
        state.columnMeta[key] = { ...(state.columnMeta[key] || {}), ...meta };
        return state.columnMeta[key];
      },

      // Formatters
      format(value, type = 'text', options = {}) { return FormatterRegistry.format(value, type, options); },
      registerFormatter(type, fn) { FormatterRegistry.register(type, fn); return api; },

      // Storage
      cacheSet(key, value, expirySecs = null) { return Storage.set(key, value, expirySecs); },
      cacheGet(key) { return Storage.get(key); },
      cacheDelete(key) { return Storage.delete(key); },

      // IO
      fetchData(url, opts = {}) { return IO.fetchData(url, opts); },
      parseCSV(csvString, opts = {}) { return IO.parseCSV(csvString, opts); },
      toCSV(data, opts = {}) { return IO.toCSV(data, opts); },

      renderDetailById(id, key = 'id', options = {}) {
        const rowTemp = dataset.find(r => r && r[key] === id);
        if (!rowTemp) return '';
        const row = DataEngine.cleanObject(rowTemp);

        const allColumns = inferColumnsFromData([row]);
        const columnMeta = state.columnMeta;

        const renderOpts = {
          columns: allColumns,
          columnMeta,
          classes: state.classes,
          ...options
        };

        let html = options.mode === 'table'
          ? Renderers.table([row], renderOpts)
          : Renderers.cards([row], renderOpts);

        html += "<button>Close</button>";


        if (options.mount) {
          const el = document.querySelector(options.mount);
          if (el) el.innerHTML = html;
          el.querySelector('button').addEventListener('click', () => {
            el.innerHTML = '';
          });
        }

        return html;
      },
      // Rendering (returns HTML; optional DOM mount via options.mount or state.domSelectors)
      renderData(opts = {}) {
        if (state.domSelectors.table) return api.renderTable(opts);
        if (state.domSelectors.cards) return api.renderCards(opts);
      },
      renderTable(opts = {}) {
        const local = { ...state, ...opts };
        const rows = effectiveData(local);
        const html = Renderers.table(rows, local);
        //if (opts.mount || state.domSelectors.table) {
        //mountHTML(opts.mount || state.domSelectors.table, html);
        //}
        return html;
      },
      renderCards(opts = {}) {
        const local = { ...state, ...opts };
        const rows = effectiveData(local);
        const html = Renderers.cards(rows, local);
        if (opts.mount || state.domSelectors.cards) {
          //mountHTML(opts.mount || state.domSelectors.table, html);
        }
        return html;
      },
      renderPagination(opts = {}) {
        const local = { ...state, ...opts };
        const stats = effectiveStats(local);
        const html = Renderers.pagination({ ...local, ...stats });
        const mountSel = opts.mount || state.domSelectors.pagination;
        if (mountSel) {
          if (mountHTML(mountSel, html)) wirePaginationInteractions(mountSel);
        }
        return html;
      },

      // Filter UI generator (returns HTML; optional mount)
      renderFilters(configOrOpts = {}) {//configOrOpts = {};
        return generateForm(configOrOpts);
      },

      // Convenience combined pipeline
      pipeline(opts = {}) {
        const rows = effectiveData(opts);
        const stats = effectiveStats(opts);
        return { rows, stats };
      }
    };

    return api;
  }

  // Attach to global
  global.DataLib = DataLib;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));