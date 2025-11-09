function diceApp(containerId, options = {}) {
  class DiceApp {
    static STORAGE_KEY = "diceAppState_v1";
    static STANDARD_SIZES = [2, 4, 5, 6, 7, 8, 10, 12, 20, 100];
    static PRESET_SIZES = [2, 4, 5, 6, 7, 8, 10, 12, 20, 100];
    constructor(containerId, options) {
      this.container = containerId ? document.getElementById(containerId) : null;
      this.options = options || {};
      this.state = this.loadState() || {
        input: "",
        unique: false,
        results: null,
        timestamp: null
      };
      this.state.presets = this.state.presets || DiceApp.PRESET_SIZES.reduce((acc, s) => {
        acc['d' + s] = 0;
        return acc;
      }, {});
      // ensure combineDuplicates exists
      if (typeof this.state.combineDuplicates !== "boolean") {
        this.state.combineDuplicates = true;
      }



      this.injectCSS();
      if (this.container) this.buildUI();

      // API-triggered roll: allow direct string or structured specs
      if (this.options.dice) {
        const inputStr = typeof this.options.dice === "string"
          ? this.options.dice
          : this.normalizeDiceSpecs(this.options.dice);
        const unique = !!this.options.unique;
        const results = this.roll(inputStr, unique);
        // If no container, return the full summary for API usage
        if (!this.container) return results;
      } else if (!this.container && this.state.results) {
        // If API-only and state exists, return last results
        return this.state.results;
      }
    }

    // Normalize structured input like [{count:3, size:6}, {count:2, range:"4-5,9-23"}]
    normalizeDiceSpecs(specs) {
      if (!Array.isArray(specs)) return "";
      const parts = specs.map(s => {
        if (s.range) {
          const n = s.count && s.count > 0 ? `${s.count}@` : "";
          return `${n}${s.range}`;
        }
        if (s.size) {
          const n = s.count && s.count > 0 ? `${s.count}` : "1";
          return `${n}d${s.size}`;
        }
        return "";
      }).filter(Boolean);
      return parts.join(", ");
    }

    injectCSS() {
      if (document.getElementById("dice-app-styles")) return;
      const style = document.createElement("style");
      style.id = "dice-app-styles";
      style.textContent = `
        :root{--die-accent:#66c;--die-sel:#3c3;--die-muted:#666,--die-bg:#333;--die-fg:#ccc;}
        .dice-app { color: var(--die-fg); max-width: 900px; margin: 1rem auto; }
        .dice-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: .75rem; }
        .dice-title { font-size: 1.25rem; font-weight: 600; }
        .dice-form { /*display: grid; grid-template-columns: 1fr auto auto; gap: .5rem; align-items: end;*/ margin-bottom: 1rem; }
        .dice-field { display: flex; flex-direction: column; gap: .25rem; }
        .dice-input, .dice-select, .dice-number { border: 1px solid var(--die-accent); border-radius: 6px; padding: .5rem .6rem; font-size: .95rem; }
        .dice-checkbox-row { display: flex; align-items: center; gap: .5rem; }
        .dice-btn { border: 1px solid var(--die-accent); background: var(--die-sel); color: var(--die-fg); padding: .5rem .9rem; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .dice-btn:hover { background: var(--die-accent); }
        .dice-btn-secondary { border-color: var(--die-accent); color: var(--die-fg); }
        .dice-results { margin-top: .75rem; display: grid; gap: 1rem; }
        .dice-card { border: 1px solid var(--die-accent); border-radius: 8px; padding: .75rem; background: var(--die-bg); }
        .dice-card-title { font-weight: 600; margin-bottom: .5rem; }
        .dice-table { border-collapse: collapse; width: 100%; }
        .dice-table th, .dice-table td { border: 1px solid var(--die-accent); padding: .4rem .5rem; text-align: right; }
        .dice-table th { background: var(--die-bg); font-weight: 600; }
        .dice-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-top: .5rem; }
        .dice-summary-item { border: 1px solid var(--die-accent); border-radius: 6px; padding: .5rem; background: var(--die-bg); }
        .dice-summary-label { font-weight: 600; }
        .dice-inline-hint { color: var(--die-fg); font-size: .9rem; margin-top: .25rem; }
        .dice-footer { display: flex; align-items: center; justify-content: space-between; margin-top: .5rem; color: var(--die-fg); font-size: .85rem; }
        .dice-presets { margin-bottom:.6rem; }
        .dice-preset { margin:5px;display:grid;grid-template-columns:150px 1fr; align-items:center; gap:.35rem; }
        .dice-preset-toggle { border:1px solid var(--die-accent); background:var(--die-bg);color:var(--die-fg); padding:.25rem .45rem; border-radius:6px; cursor:pointer; font-weight:600; }
        .dice-preset-toggle[aria-pressed="true"] { background:var(--die-sel); color:var(--die-fg); border-color:var(--die-muted); }
        .dice-preset-qty { background:var(--die-bg);color:var(--die-fg);padding:.25rem; border:1px solid var(--die-accent); border-radius:6px; text-align:center; }
        @media (max-width: 640px) {
          .dice-form { grid-template-columns: 1fr; }
          .dice-summary { grid-template-columns: 1fr; }
        }
      `;
      document.head.appendChild(style);
    }

    buildUI() {
      this.container.classList.add("dice-app");

      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="dice-header" role="heading" aria-level="1">
          <div class="dice-title">Dice Roller</div>
          <div>
            <button type="button" class="dice-btn dice-btn-secondary" data-action="reset">Reset</button>
          </div>
        </div>

        <form class="dice-form" aria-label="Dice configuration">
        <div class="dice-field">
  <label>Quick presets</label>
  <div class="dice-presets" id="dice-presets" role="group" aria-label="Standard dice presets"></div>
</div>
          <div class="dice-field">
            <label for="dice-input">Dice and ranges</label>
            <input id="dice-input" class="dice-input" name="dice" type="text" placeholder="e.g. 3d6, d20, 100, 3@4-5,9-23,44,99">
            <div class="dice-inline-hint">
              Supported: NdX (e.g. 3d6), custom size (e.g. d37 or 37), ranges/lists (e.g. 4-5,9-23,44,99). Use N@ before ranges to set quantity (e.g. 2@9-12,44).
            </div>
          </div>

          <div class="dice-field">
            <div>Options</div>
            <div class="dice-checkbox-row">
              <input id="unique-checkbox" name="unique" type="checkbox" aria-describedby="unique-desc">
              <label for="unique-checkbox">No duplicate results per set</label>
            </div>
            <div id="unique-desc" class="dice-inline-hint">Ensures rolls in a set are unique when possible (limited by the pool size).</div>
           <div class="dice-checkbox-row" style="margin-top:6px;">
    <input id="combine-checkbox" name="combine" type="checkbox" aria-describedby="combine-desc">
    <label for="combine-checkbox">Combine identical dice sets</label>
  </div>
  <div id="combine-desc" class="dice-inline-hint">When enabled, multiple entries of the same die (e.g. 1d3 and 5d3) are combined into 6d3 for rolling and summary.</div>

         
            </div>

          <div class="dice-field">
            <button type="submit" class="dice-btn">Roll</button>
          </div>
        </form>

        <div class="dice-results" aria-live="polite" aria-label="Roll results"></div>

        <div class="dice-footer">
          <div>Standard dice: ${DiceApp.STANDARD_SIZES.map(n => `d${n}`).join(", ")}</div>
          <div class="dice-inline-hint">Settings and last results are saved.</div>
        </div>
      `;
      this.container.appendChild(wrapper);
      this.renderPresets();
      this.syncPresetsToInput(); // ensure main input reflects persisted presets

      const form = this.container.querySelector(".dice-form");
      const resetBtn = this.container.querySelector('[data-action="reset"]');

      // Initialize form from state
      if (this.state.input) form.dice.value = this.state.input;
      if (this.state.unique) form.unique.checked = this.state.unique;
      if (this.state.combineDuplicates) form.combine.checked = this.state.combineDuplicates;
      const diceInputEl = this.container.querySelector("#dice-input");
      diceInputEl.addEventListener("input", () => {
        this.state.input = diceInputEl.value;
        this.updatePresetStateFromInput();
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const diceInput = form.dice.value.trim();
        const unique = form.unique.checked;
        const combine = form.combine.checked;
        this.roll(diceInput, {unique,combine});
      });

      resetBtn.addEventListener("click", () => {
        this.reset();
      });

      // Render last results if present
      if (this.state.results) {
        this.renderResults(this.state.results);
      }
    }

    // Parse input into sets { label, values, count, domainLabel }
    parseDice(input) {
      const txt = (input || "").trim();
      if (!txt) return [];

      // Split by commas at top level
      const tokens = txt.split(",").map(s => s.trim()).filter(Boolean);
      const sets = [];

      for (const token of tokens) {
        // Range/list with optional N@ prefix: e.g. 3@4-5,9-23,44
        const atIdx = token.indexOf("@");
        let prefixCount = null;
        let rangePart = token;

        if (atIdx > -1) {
          const rawN = token.slice(0, atIdx).trim();
          const n = parseInt(rawN, 10);
          if (!Number.isNaN(n) && n > 0) {
            prefixCount = n;
            rangePart = token.slice(atIdx + 1).trim();
          }
        }

        // NdX or dX
        const ndxMatch = rangePart.match(/^(\d+)?\s*d\s*(\d+)$/i);
        const justNumber = rangePart.match(/^\d+$/);

        if (ndxMatch) {
          const count = parseInt(ndxMatch[1] || "1", 10);
          const size = parseInt(ndxMatch[2], 10);
          if (Number.isFinite(count) && count > 0 && Number.isFinite(size) && size > 0) {
            const values = Array.from({ length: size }, (_, i) => i + 1);
            sets.push({
              label: `${count}d${size}`,
              domainLabel: `d${size}`,
              values,
              count
            });
            continue;
          }
        }

        if (justNumber) {
          const size = parseInt(rangePart, 10);
          if (Number.isFinite(size) && size > 0) {
            const values = Array.from({ length: size }, (_, i) => i + 1);
            sets.push({
              label: `1d${size}`,
              domainLabel: `d${size}`,
              values,
              count: prefixCount || 1
            });
            continue;
          }
        }

        // Range/explicit list parsing (supports sequences like "4-5", "9-23", "44", "99")
        const subParts = rangePart.split(/\s+/).join("").split(";").join(",").split(",").filter(Boolean);
        const pool = new Set();
        for (const part of subParts) {
          const m = part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
          if (m) {
            const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
            if (Number.isFinite(a) && Number.isFinite(b)) {
              const start = Math.min(a, b), end = Math.max(a, b);
              for (let v = start; v <= end; v++) pool.add(v);
            }
          } else {
            const v = parseInt(part, 10);
            if (Number.isFinite(v)) pool.add(v);
          }
        }
        if (pool.size > 0) {
          const values = Array.from(pool.values()).sort((x, y) => x - y);
          const count = prefixCount || 1;
          const labelCount = count > 1 ? `${count}×` : "";
          const label = `${labelCount}{${values.join(",")}}`;
          sets.push({
            label,
            domainLabel: `{${values.length} values}`,
            values,
            count
          });
          continue;
        }

        // Fallback: ignore invalid token
      }

      return sets;
    }
    renderPresets() {
      const container = this.container.querySelector("#dice-presets");
      container.innerHTML = "";
      for (const size of DiceApp.PRESET_SIZES) {
        const key = 'd' + size;
        const wrapper = document.createElement("div");
        wrapper.className = "dice-preset";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dice-preset-toggle";
        btn.textContent = `d${size}`;
        btn.setAttribute("aria-pressed", this.state.presets[key] > 0 ? "true" : "false");
        btn.dataset.size = String(size);

        const qty = document.createElement("input");
        qty.type = "number";
        qty.min = "0";
        qty.step = "1";
        qty.className = "dice-preset-qty";
        qty.value = String(this.state.presets[key] || 0);
        qty.dataset.size = String(size);
        qty.title = `Quantity for d${size}`;

        btn.addEventListener("click", (e) => {
          const s = e.currentTarget.dataset.size;
          const k = 'd' + s;
          const curr = Number(this.state.presets[k] || 0);
          const next = curr > 0 ? 0 : 1;
          this.state.presets[k] = next;
          // update DOM
          btn.setAttribute("aria-pressed", next > 0 ? "true" : "false");
          qty.value = String(next);
          this.saveState();
          this.syncPresetsToInput();
        });

        qty.addEventListener("input", (e) => {
          let v = parseInt(e.currentTarget.value || "0", 10);
          if (!Number.isFinite(v) || v < 0) v = 0;
          e.currentTarget.value = String(v);
          const s = e.currentTarget.dataset.size;
          const k = 'd' + s;
          this.state.presets[k] = v;
          const btnPressed = v > 0;
          const btnEl = wrapper.querySelector(".dice-preset-toggle");
          if (btnEl) btnEl.setAttribute("aria-pressed", btnPressed ? "true" : "false");
          this.saveState();
          this.syncPresetsToInput();
        });

        wrapper.appendChild(btn);
        wrapper.appendChild(qty);
        container.appendChild(wrapper);
      }
    }

    syncPresetsToInput() {
      // Build preset tokens
      const presetTokens = [];
      for (const size of DiceApp.PRESET_SIZES) {
        const key = 'd' + size;
        const qty = Number(this.state.presets[key] || 0);
        if (qty > 0) {
          presetTokens.push(qty === 1 ? `d${size}` : `${qty}d${size}`);
        }
      }
      const form = this.container.querySelector(".dice-form");
      if (!form) return;
      // preserve user free-text after presets: if user had typed non-preset tokens, keep them
      const userInput = (this.state.input || "").trim();
      // remove any preset-like tokens from userInput to avoid duplicates
      const userTokens = userInput ? userInput.split(",").map(t => t.trim()).filter(Boolean) : [];
      const filteredUserTokens = userTokens.filter(t => {
        // filter tokens that are exact NdX or dX matching preset sizes
        const m = t.match(/^(\d+)?\s*d\s*(\d+)$/i);
        if (m) {
          const sz = Number(m[2]);
          return !DiceApp.PRESET_SIZES.includes(sz);
        }
        return true;
      });
      const combined = presetTokens.concat(filteredUserTokens);
      const combinedStr = combined.join(", ");
      form.dice.value = combinedStr;
      // update state.input (but do not overwrite other state fields)
      this.state.input = combinedStr;
      this.saveState();
    }

    updatePresetStateFromInput() {
      // Optional: parse current input and set preset quantities when NdX tokens match presets
      const form = this.container.querySelector(".dice-form");
      if (!form) return;
      const tokens = (form.dice.value || "").split(",").map(t => t.trim()).filter(Boolean);
      // reset
      for (const size of DiceApp.PRESET_SIZES) this.state.presets['d' + size] = 0;
      for (const tok of tokens) {
        const m = tok.match(/^(\d+)?\s*d\s*(\d+)$/i);
        if (m) {
          const cnt = Number(m[1] || 1);
          const sz = Number(m[2]);
          if (DiceApp.PRESET_SIZES.includes(sz)) {
            this.state.presets['d' + sz] = (this.state.presets['d' + sz] || 0) + cnt;
          }
        }
      }
      this.saveState();
      // refresh UI to reflect changes
      this.renderPresets();
    }
    // Perform rolls with optional uniqueness constraint
    doRollsForSet(set, unique) {
      const { values, count } = set;
      const rolls = [];
      if (unique) {
        const pool = values.slice();
        for (let i = 0; i < count; i++) {
          if (pool.length === 0) break;
          const idx = Math.floor(Math.random() * pool.length);
          const picked = pool.splice(idx, 1)[0];
          rolls.push(picked);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(Math.random() * values.length);
          rolls.push(values[idx]);
        }
      }
      return rolls;
    }

    // Summarize frequencies, averages, totals per set and combined
    summarize(setsWithRolls) {
      // Per set
      const perSet = setsWithRolls.map(s => {
        const freq = new Map();
        for (const v of s.values) freq.set(v, 0);
        for (const r of s.rolls) freq.set(r, (freq.get(r) || 0) + 1);

        const total = s.rolls.reduce((acc, v) => acc + v, 0);
        const avg = s.rolls.length ? (total / s.rolls.length) : 0;

        return {
          label: s.label,
          domainLabel: s.domainLabel,
          countRequested: s.count,
          countRolled: s.rolls.length,
          total,
          average: avg,
          freq: Array.from(freq.entries()).sort((a, b) => a[0] - b[0]),
          rolls: s.rolls.slice()
        };
      });

      // Combined
      const combinedFreq = new Map();
      let combinedTotal = 0;
      let combinedCount = 0;
      for (const setSum of perSet) {
        for (const [val, cnt] of setSum.freq) {
          combinedFreq.set(val, (combinedFreq.get(val) || 0) + cnt);
        }
        combinedTotal += setSum.total;
        combinedCount += setSum.countRolled;
      }
      const combinedAverage = combinedCount ? (combinedTotal / combinedCount) : 0;

      return {
        perSet,
        combined: {
          total: combinedTotal,
          average: combinedAverage,
          countRolled: combinedCount,
          freq: Array.from(combinedFreq.entries()).sort((a, b) => a[0] - b[0])
        }
      };
    }

    // Create HTML for tables and summaries
    renderResults(resultsObj) {
      if (!this.container) return resultsObj;
      const root = this.container.querySelector(".dice-results");
      root.innerHTML = "";

      const { perSet, combined } = resultsObj.summary;

      // Per-set cards
      for (const s of perSet) {
        const card = document.createElement("div");
        card.className = "dice-card";
        const title = document.createElement("div");
        title.className = "dice-card-title";
        title.textContent = `${s.label} (${s.domainLabel})`;
        card.appendChild(title);

        const table = document.createElement("table");
        table.className = "dice-table";
        table.setAttribute("aria-label", `Results for ${s.label}`);
        const thead = document.createElement("thead");
        thead.innerHTML = `
          <tr>
            <th style="text-align:left">Value</th>
            <th>Count</th>
          </tr>`;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const [val, cnt] of s.freq) {
          if (cnt === 0) continue;
          const tr = document.createElement("tr");
          const tdV = document.createElement("td");
          tdV.style.textAlign = "left";
          tdV.textContent = String(val);
          const tdC = document.createElement("td");
          tdC.textContent = String(cnt);
          tr.appendChild(tdV);
          tr.appendChild(tdC);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        card.appendChild(table);

        const summary = document.createElement("div");
        summary.className = "dice-summary";
        summary.innerHTML = `
          <div class="dice-summary-item">
            <div class="dice-summary-label">Requested</div>
            <div>${s.countRequested}</div>
          </div>
          <div class="dice-summary-item">
            <div class="dice-summary-label">Rolled</div>
            <div>${s.countRolled}</div>
          </div>
          <div class="dice-summary-item">
            <div class="dice-summary-label">Total</div>
            <div>${s.total}</div>
          </div>
          <div class="dice-summary-item">
            <div class="dice-summary-label">Average</div>
            <div>${s.average.toFixed(3)}</div>
          </div>
          <div class="dice-summary-item" style="grid-column: span 3;">
            <div class="dice-summary-label">Rolls</div>
            <div>${s.rolls.join(", ") || "—"}</div>
          </div>
        `;
        card.appendChild(summary);
        root.appendChild(card);
      }
      if (perSet.length > 1) {
        // Combined card
        const combinedCard = document.createElement("div");
        combinedCard.className = "dice-card";
        const combinedTitle = document.createElement("div");
        combinedTitle.className = "dice-card-title";
        combinedTitle.textContent = "Combined summary (all dice types)";
        combinedCard.appendChild(combinedTitle);

        const combinedTable = document.createElement("table");
        combinedTable.className = "dice-table";
        combinedTable.setAttribute("aria-label", "Combined results");
        const thead2 = document.createElement("thead");
        thead2.innerHTML = `
        <tr>
          <th style="text-align:left">Value</th>
          <th>Count</th>
        </tr>`;
        combinedTable.appendChild(thead2);

        const tbody2 = document.createElement("tbody");
        for (const [val, cnt] of combined.freq) {
          if (cnt === 0) continue;
          const tr = document.createElement("tr");
          const tdV = document.createElement("td");
          tdV.style.textAlign = "left";
          tdV.textContent = String(val);
          const tdC = document.createElement("td");
          tdC.textContent = String(cnt);
          tr.appendChild(tdV);
          tr.appendChild(tdC);
          tbody2.appendChild(tr);
        }
        combinedTable.appendChild(tbody2);
        combinedCard.appendChild(combinedTable);

        const combinedSummary = document.createElement("div");
        combinedSummary.className = "dice-summary";
        combinedSummary.innerHTML = `
        <div class="dice-summary-item">
          <div class="dice-summary-label">Total</div>
          <div>${combined.total}</div>
        </div>
        <div class="dice-summary-item">
          <div class="dice-summary-label">Average</div>
          <div>${combined.average.toFixed(3)}</div>
        </div>
        <div class="dice-summary-item">
          <div class="dice-summary-label">Count</div>
          <div>${combined.countRolled}</div>
        </div>
      `;
        combinedCard.appendChild(combinedSummary);

        root.appendChild(combinedCard);
      }
      return resultsObj;
    }
// Merge sets with identical domains by summing counts
mergeDuplicateSets(sets) {
  const map = new Map();
  for (const s of sets) {
    // Build canonical domain key
    // For standard dice where values are 1..N, detect by continuous range starting at 1
    let domainKey, domainLabel;
    const vals = Array.isArray(s.values) ? s.values.slice() : [];
    vals.sort((a,b) => a-b);
    const isStandardDie = vals.length > 0 && vals[0] === 1 && vals.every((v,i)=> v === i+1);
    if (isStandardDie) {
      const size = vals.length;
      domainKey = `d${size}`;
      domainLabel = `d${size}`;
    } else {
      domainKey = `pool:${vals.join(",")}`;
      domainLabel = `{${vals.join(",")}}`;
    }

    const existing = map.get(domainKey);
    if (existing) {
      existing.count += s.count;
      // preserve values (same domain) and append original label for traceability
      existing.label = existing.label + " + " + s.label;
    } else {
      // make a shallow copy to avoid mutating original
      map.set(domainKey, {
        label: s.label,
        domainLabel,
        values: vals.slice(),
        count: s.count
      });
    }
  }

  // Post-process labels to be cleaner: set label like '6d3' or '6×{...}'
  const merged = [];
  for (const [key, v] of map.entries()) {
    if (key.startsWith("d")) {
      const size = key.slice(1);
      const total = v.count;
      v.label = `${total}d${size}`;
      v.domainLabel = `d${size}`;
    } else {
      v.label = `${v.count}×{${v.values.join(",")}}`;
    }
    merged.push(v);
  }
  return merged;
}
    // Public roll path
    roll(input, opt = {}) {
      const sets = this.parseDice(input);
      if (sets.length === 0) {
        const presets = { ...this.state.presets };
        const empty = {
          input: input || "",
          unique: opt.unique || false,
          combineDuplicates: opt.combine || false,
          results: {
            sets: [],
            summary: { perSet: [], combined: { total: 0, average: 0, countRolled: 0, freq: [] } }
          },
          presets,
          timestamp: Date.now()
        };
        this.state = empty;
        this.saveState();
        if (this.container) this.renderResults(empty.results);
        return empty.results;
      }
const parsedSets = this.parseDice(input);
const setsToRoll = opt.combine ? this.mergeDuplicateSets(parsedSets) : parsedSets;
const setsWithRolls = setsToRoll.map(s => ({ ...s, rolls: this.doRollsForSet(s, opt.unique) }));
     // const setsWithRolls = sets.map(s => ({ ...s, rolls: this.doRollsForSet(s, opt.unique) }));
      const summary = this.summarize(setsWithRolls);
      const results = { sets: setsWithRolls, summary };
      const presets = { ...this.state.presets };

      this.state = { input, presets, unique:opt.unique,combineDuplicates:opt.combine, results, timestamp: Date.now() };
      this.saveState();

      if (this.container) this.renderResults(results);
      return results;
    }

    reset() {
      //this.state = this.state { input: "", unique: false, results: null, timestamp: null };
		  this.state = { ...this.state, ...{input: "", unique: false, results: null, timestamp: null } };
      this.saveState();
      if (this.container) {
        const form = this.container.querySelector(".dice-form");
        form.dice.value = "";
        form.unique.checked = false;
        const root = this.container.querySelector(".dice-results");
        root.innerHTML = "";
      }
      this.renderPresets();
    }

    saveState() {
      try {
        localStorage.setItem(DiceApp.STORAGE_KEY, JSON.stringify(this.state));
      } catch { /* ignore storage errors */ }
    }

    loadState() {
      try {
        const raw = localStorage.getItem(DiceApp.STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  }

  // Return instance for chaining when container is present; otherwise, return results directly if options.dice was provided
  const app = new DiceApp(containerId, options);
  return app;
}