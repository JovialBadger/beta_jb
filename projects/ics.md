---
layout: default
title: ICS_Generator
category: Web_Scripts
order: 1
---
<div id='containerICSGenerator'></div>
<script src="{{ "/assets/js/ics.js" | relative_url }}"></script>
<script>
    const options = {
        containerID: 'containerICSGenerator', // selector or Element
    }
    icsGenerator(options);
</script>