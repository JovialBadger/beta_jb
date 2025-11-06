---
---
function icsGenerator(options = {}){
		// --------- Configuration & Persistence ----------
		const DEFAULTS = {
			containerID: null, // selector or Element
		};
		const opts = { ...DEFAULTS, ...options };
		let container = document.getElementById(opts.containerID) || document.querySelector(opts.containerID) || document.body;
        
        const _css = `
    /*body {
      font-family: Arial, sans-serif;
      margin: 20px;
      background-color: #f9f9f9;
    }
    h2 {
      color: #333;
    }*/
    .icsGeneratorContainer {
      max-width: 1000px;
      margin: auto;
      /*background: #fff;*/
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }
    .icsGeneratorContainer .item {
      border: 1px solid #ccc;
      padding: 15px;
      margin: 10px 0;
      border-radius: 5px;
      /*background: #f0f0f0;*/
    }
    .icsGeneratorContainer .optional {
      display: none;
      margin-top: 10px;
    }
    .icsGeneratorContainer label {
      display: block;
      margin-top: 8px;
      font-weight: bold;
    }
    .icsGeneratorContainer input, .icsGeneratorContainer select, .icsGeneratorContainer textarea {
      width: 100%;
      padding: 6px;
      margin-top: 4px;
      box-sizing: border-box;
    }
    .icsGeneratorContainer button {
      margin: 10px 5px 0 0;
      padding: 8px 12px;
      font-size: 14px;
    }
    .icsGeneratorContainer .header-config {
      margin-bottom: 20px;
      padding: 10px;
      /*background: #e0e0e0;*/
      border-radius: 5px;
    }
    .icsGeneratorContainer .export-buttons {
      margin-top: 20px;
    }
      `;
    var style = document.createElement('style');
    style.appendChild(document.createTextNode(_css));
    container.appendChild(style);

const _html = `
  <div class="icsGeneratorContainer">
    <h2>ICS Generator Tool</h2>

    <div class="header-config">
      <label for="version">VCALENDAR VERSION</label>
      <input id="version" value="2.0">
      <label for="prodid">PRODID</label>
      <input id="prodid" value="-//Custom ICS Generator//EN">
      <label for="method">METHOD</label>
      <input id="method" value="PUBLISH">
      <label for="timezone">TIMEZONE</label>
      <input id="timezone" value="UTC">
      <button id="btnSetLocalTimezone">Set Local Timezone</button>
    </div>

    <div id="items"></div>
    <button id="btnAddItem">Add New Item</button>
    <button id="btnDownloadCSVTemplate">Download CSV Template</button>
    <input type="file" accept=".csv,.ics" id="btnHandleFileUpload">
    <div class="export-buttons">
      <button id="btnDownloadICS">Export ICS</button>
      <button id="btnExportJSON">Export JSON</button>
      <button id="btnExportCSV">Export CSV</button>
      <button id="btnExportText">Export Text</button>
    </div>
  </div>
`;
    var div = document.createElement('div');
    div.innerHTML = _html;

    div.querySelector('#btnSetLocalTimezone').addEventListener('click', setLocalTimezone);
    div.querySelector('#btnAddItem').addEventListener('click', () => addItem());
    div.querySelector('#btnDownloadCSVTemplate').addEventListener('click', downloadCSVTemplate);
    div.querySelector('#btnHandleFileUpload').addEventListener('change', handleFileUpload);
    div.querySelector('#btnDownloadICS').addEventListener('click', downloadICS);
    div.querySelector('#btnExportJSON').addEventListener('click', exportJSON);
    div.querySelector('#btnExportCSV').addEventListener('click', exportCSV);
    div.querySelector('#btnExportText').addEventListener('click', exportText);

    container.appendChild(div);

    let items = [];

    function generateUID() {
      return 'uid-' + Math.random().toString(36).substring(2, 15);
    }

    function setLocalTimezone() {
      try {
        document.getElementById('timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        document.getElementById('timezone').value = 'UTC';
      }
    }

    function toggleOptional(index) {
      const section = document.getElementById(`optional-${index}`);
      section.style.display = section.style.display === 'none' ? 'block' : 'none';
    }

    function copyItem(index) {
      const itemData = collectItemData(index);
      addItem(itemData);
    }

    function addItem(data = {}) {
      const index = items.length;
      items.push({ uid: generateUID() });

      const container = document.getElementById('items');
      const div = document.createElement('div');
      div.className = 'item';
      div.id = `item-${index}`;
      div.innerHTML = `
        <h4>Item ${index + 1}</h4>
        <label>Type</label>
        <select id="type-${index}">
          <option value="VEVENT">Event</option>
          <option value="VTODO">To-Do</option>
          <option value="VJOURNAL">Journal</option>
        </select>
        <label>Summary</label>
        <input id="summary-${index}" value="${data.summary || ''}">
        <label>Start Date/Time</label>
        <input type="datetime-local" id="start-${index}" value="${data.start || ''}">
        <label>End Date/Time</label>
        <input type="datetime-local" id="end-${index}" value="${data.end || ''}">
        <button id="btnToggleOptional-${index}">Show/Hide Optional Fields</button>
        <div class="optional" style="display:none" id="optional-${index}">
          <label>Location</label>
          <input id="loc-${index}" value="${data.location || ''}">
          <label>Description</label>
          <textarea id="desc-${index}">${data.description || ''}</textarea>
          <label>Alarm (minutes before)</label>
          <input id="alarm-${index}" value="${data.alarm || ''}">
          <label>Recurrence Frequency</label>
          <select id="freq-${index}">
            <option value="">None</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
          <label>Interval</label>
          <input id="interval-${index}" type="number" min="1" value="${data.interval || ''}">
          <label>End Condition</label>
          <select id="endtype-${index}">
            <option value="">None</option>
            <option value="COUNT">By Count</option>
            <option value="UNTIL">By Date</option>
          </select>
          <label>End Value</label>
          <input id="endvalue-${index}" value="${data.endvalue || ''}">
        </div>
        <button id="btnCopyItem-${index}">Copy</button>
        <button id="btnDeleteItem-${index}">Delete</button>
      `;

    // Add event listeners to buttons
    div.querySelector(`#btnToggleOptional-${index}`).addEventListener('click', () => toggleOptional(index));
    div.querySelector(`#btnCopyItem-${index}`).addEventListener('click', () => copyItem(index));
    div.querySelector(`#btnDeleteItem-${index}`).addEventListener('click', () => deleteItem(index));
      container.appendChild(div);
    }

    function deleteItem(index) {
      items[index] = null;
      const div = document.getElementById(`item-${index}`);
      if (div) div.remove();
    }

    function collectItemData(index) {
      return {
        type: document.getElementById(`type-${index}`).value,
        summary: document.getElementById(`summary-${index}`).value,
        start: document.getElementById(`start-${index}`).value,
        end: document.getElementById(`end-${index}`).value,
        location: document.getElementById(`loc-${index}`)?.value || '',
        description: document.getElementById(`desc-${index}`)?.value || '',
        alarm: document.getElementById(`alarm-${index}`)?.value || '',
        freq: document.getElementById(`freq-${index}`)?.value || '',
        interval: document.getElementById(`interval-${index}`)?.value || '',
        endtype: document.getElementById(`endtype-${index}`)?.value || '',
        endvalue: document.getElementById(`endvalue-${index}`)?.value || ''
      };
    }

    function formatDate(dateStr) {
      return new Date(dateStr).toISOString().replace(/[-:]/g, '').split('.')[0];
    }

    function buildRRULE(data) {
      if (!data.freq) return '';
      let rule = `FREQ=${data.freq}`;
      if (data.interval) rule += `;INTERVAL=${data.interval}`;
      if (data.endtype === 'COUNT') rule += `;COUNT=${data.endvalue}`;
      if (data.endtype === 'UNTIL') rule += `;UNTIL=${formatDate(data.endvalue)}`;
      return rule;
    }

    function downloadICS() {
      const version = document.getElementById('version').value;
      const prodid = document.getElementById('prodid').value;
      const method = document.getElementById('method').value;
      const tz = document.getElementById('timezone').value;

      let ics = `BEGIN:VCALENDAR
VERSION:${version}
PRODID:${prodid}
METHOD:${method}
CALSCALE:GREGORIAN
`;

      items.forEach((item, i) => {
        if (!item) return;
        const data = collectItemData(i);
        const start = formatDate(data.start);
        const end = formatDate(data.end);
        const rrule = buildRRULE(data);

        ics += `BEGIN:${data.type}
UID:${items[i].uid}
SUMMARY:${data.summary}
`;
        if (data.description) ics += `DESCRIPTION:${data.description}
`;
        if (data.location) ics += `LOCATION:${data.location}
`;
        if (data.start) ics += `DTSTART;TZID=${tz}:${start}
`;
        if (data.end) ics += `DTEND;TZID=${tz}:${end}
`;
        if (rrule) ics += `RRULE:${rrule}
`;
        if (data.alarm) {
          ics += `BEGIN:VALARM
TRIGGER:-PT${data.alarm}M
ACTION:DISPLAY
DESCRIPTION:${data.summary}
END:VALARM
`;
        }
        ics += `END:${data.type}
`;
      });

      ics += `END:VCALENDAR`;

      const blob = new Blob([ics], { type: 'text/calendar' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `calendar-${generateUID()}.ics`;
      link.click();
    }

    function exportJSON() {
      const data = items.map((item, i) => item ? collectItemData(i) : null).filter(Boolean);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'calendar.json';
      link.click();
    }

    function exportCSV() {
      const headers = ['Type','Summary','Description','Location','Start','End','Alarm','Frequency','Interval','EndType','EndValue'];
      const rows = items.map((item, i) => {
        if (!item) return null;
        const d = collectItemData(i);
        return [d.type,d.summary,d.description,d.location,d.start,d.end,d.alarm,d.freq,d.interval,d.endtype,d.endvalue].join(',');
      }).filter(Boolean);
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'calendar.csv';
      link.click();
    }

    function exportText() {
      const lines = items.map((item, i) => {
        if (!item) return null;
        const d = collectItemData(i);
        return `Item ${i+1}: ${d.type} - ${d.summary} (${d.start} to ${d.end})`;
      }).filter(Boolean);
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'calendar.txt';
      link.click();
    }

    function downloadCSVTemplate() {
      const csv = 'Type,Summary,Description,Location,Start,End,Alarm,Frequency,Interval,EndType,EndValue\nVEVENT,Meeting,Discuss project,Office,2025-09-22T10:00,2025-09-22T11:00,15,DAILY,1,COUNT,5';
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'ics-template.csv';
      link.click();
    }

    function handleFileUpload(event) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result;
        if (file.name.endsWith('.csv')) {
          const lines = content.split('\n').slice(1);
          lines.forEach(line => {
            const [type, summary, desc, loc, start, end, alarm, freq, interval, endtype, endvalue] = line.split(',');
            addItem({ type, summary, description: desc, location: loc, start, end, alarm, freq, interval, endtype, endvalue });
          });
        } else if (file.name.endsWith('.ics')) {
          alert('ICS import is supported but parsing is limited in this version.');
        }
      };
      reader.readAsText(file);
    }
}