---
layout: default
title: Data
category: Web_Scripts
order: 1
---
<div id='containerDetailOutput'></div>
<div id='containerFilterOutput'></div>
<div><button id='reset-filters'>Reset Filters</button></div>
<div id='containerDataOutput'></div>
<div id='containerPagingOutput'></div>
<script src="{{ " /assets/js/data.js" | relative_url }}"></script>
<script>
  const scheduleURL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2lKSaFjfsuZK7Lseo_HsGYhq1VpQQ_qRqntI2NQqc8qlCRAY919Zje_IaCbsorgAgtA-8noCqHyWL/pub?gid=197807890&single=true&output=csv';
  const resultsURL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSfCDBr6vjSUVxA41chCnyUR46oNnPVyzCyS0_NbvLbk_9eh0Got1BPnZkIKmDngC2bp0bshVm3NiK2/pub?gid=1564670715&single=true&output=csv";
  async function init() {
    // Step 1: Fetch multiple data streams
    const lib = DataLib([], {
      rowsPerPage: 25,
      domSelectors: {
        table: '#containerDataOutput',
        pagination: '#containerPagingOutput',
        filters: '#containerFilterOutput',
        detail: '#containerDetailOutput'
      },
      globalFilter: true,
      uniqueKey: 'Match_ID',
      persistKey: 'my-datalib-state' // persist filters/sort/page across refresh
    });
    const [schedule1, results] = await Promise.all([
      lib.fetchData(scheduleURL, { type: 'csv', cacheKey: 'schedule1', expiry: 36000 }),
      lib.fetchData(resultsURL, { type: 'csv', cacheKey: 'results', expiry: 3600 })
    ]);
    //Step 2: Join datasets on userId
    const joined = lib.join([schedule1, results], ["League Year", "League Type", "Competition", "Match Number"]);
    // Add 'Submit Photo' when 'Timestamp' doesn't exist
    joined.forEach(row => {
      //const matchTime = Date.parse(row.Date);
      //const compareTime = new Date().getTime() + 86400000;
      let status = 'Complete';
      if (Object.prototype.hasOwnProperty.call(row, 'Timestamp')) {
        //const resultTime = Date.parse(row.Timestamp).getTime();
        row["Home Score"] = row["Game Status"] === 'Home Forfeit' ? 0 : row["Game Status"] === 'Away Forfeit' ? 20 : row["Home Score"];
        row["Away Score"] = row["Game Status"] === 'Home Forfeit' ? 20 : row["Game Status"] === 'Away Forfeit' ? 0 : row["Away Score"];
        const winnerVal = lib.compare(row["Home Score"], row["Away Score"]);
        row["Winner"] = winnerVal > 0 ? "Home" : winnerVal < 0 ? "Away" : "Draw";
        row["Win Difference"] = Math.abs(row["Home Score"] - row["Away Score"]);
      } else {
        row["Submit Result"] = "https://docs.google.com/forms/d/e/1FAIpQLSe_zCLLs9ADsMD2oUFQ76WKY2ZMayX_5tVO2M4h4FNhK1RhLA/viewform?usp=pp_url&entry.821820740=" + row['League Year'] + "&entry.530082834=" + row['Competition'].replace(' ', '+') + "&entry.1142329140=" + row['Match Number'] + "&entry.492201271=" + row['League Type'].replace(' ', '+');
        status = 'Awaiting Result';
      }
      row["Status"] = status;
    });
    //const schedule = await lib.fetchData(scheduleURL, { type: 'csv', cacheKey: 'schedule', expiry: 36000 });
    // Step 3: Load into library
    lib.setData(joined);
    lib.setColumns(['Match', 'Date', 'Home', 'Away']);
    //lib.setColumnMeta('Match_ID', { type: 'number',filterable:'',filterOp:'>',filterLabel:'Match ID >' });
    lib.setColumnMeta('League Year', { filterable: '', filterType: 'select' });
    lib.setColumnMeta('League Type', { filterable: '', filterType: 'select' });
    lib.setColumnMeta('Status', { filterable: '', filterType: 'select' });
    lib.setColumnMeta('Home Club,Away Club', { filterLabel: 'Club', filterable: '', filterOp: 'anyof', filterType: 'select', filterKeys: ['Home Club', 'Away Club'] });
    lib.setColumnMeta('Date', { type: 'date' });
    lib.setColumnMeta('Match', {
 concat: ['League Type', 'Competition','Match Number'],sep:'/ ' });
    lib.setColumnMeta('Home', {
 concat: ['Home Club', 'Home Team'] });
    lib.setColumnMeta('Away', { 
concat: ['Away Club', 'Away Team'] });
    lib.setColumnMeta('Match Sheet Photo', { type: 'url', formatOptions: { label: 'Open' } });
    lib.setColumnMeta('Submit Result', { type: 'url', formatOptions: { label: 'Submit' } });
   // lib.setState();
    // Step 4: Render filters (auto-wired)
    lib.renderFilters();
    // Step 5: Initial render
    lib.renderData();
    lib.renderPagination();
    // Step 6: Reset filters button
    document.getElementById('reset-filters').addEventListener('click', () => {
      lib.setState({ filters: [], page: 1 });
      lib.renderFilters();
      lib.renderData();
      lib.renderPagination();
    });
  }
  init();
  //const [users, orders] = await Promise.all([
  //  lib.fetchData(scheduleURL, { type: 'csv', cacheKey: 'users', expiry: 36000 }),
  //  lib.fetchData('https://example.com/orders.json', { type: 'json', cacheKey: 'orders', expiry: 3600 })
  //]);
  //Step 2: Join datasets on userId
  //const joined = lib.join([users, orders], [ ['id'], ['userId'] ]);
</script>