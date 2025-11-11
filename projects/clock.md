---
layout: default
title: Clock
category: Web_Scripts
order: 1
---
<div id='pageContent'></div>
<script src="{{ "/assets/js/clock.js" | relative_url }}"></script>
<script>
AnalogClockApp(/* invocation */ '#pageContent', [
  // Example default clocks if none provided externally
  { id: 'localAnalog', type: 'analog', brand: 'Jovial Badger', timezone: 0, size: 75, colors:{face:"#ffff00",border:"#ff0000",hour:"#800000",minute:"#ff80ff",second:"#00ff00",text:"#0000ff"}},
  { id: 'localDigital', type: 'digital', brand: '', timezone: 0, size: 250, digital: { format: 'ddd, dd mmm yyyy HH:MM:ss' }, show: { week: true, doy: true } }
])
</script>