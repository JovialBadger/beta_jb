---
layout: default
title: Word_Finder
category: Games
order: 1
---
<div id='containerWordFinder'></div>
<script src="{{ "/assets/js/word_finder.js" | relative_url }}"></script>
<script>
    const options = {
        containerID: 'containerWordFinder', // selector or Element
    }
    wordFinderGame(options);
</script>