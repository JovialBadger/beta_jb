---
layout: default
title: Counter
category: Games
order: 1
---
<div id='containerCounter'></div>
<script src="{{ "/assets/js/counter.js" | relative_url }}"></script>
<script>
     const app = LifeTracker(document.querySelector('#containerCounter'), {
      keepAwake: true,
      theme: 'dark',
      defaultTrackers:[
         {id: 'health', label: 'Health', value:20, step: 1,min:0 },
         {id: 'poison', label: 'Poison', value:0, step: 1,min:0 },
         {id: 'rads', label: 'Radiation', value:0, step: 1,min:0 },
      ],
    });

    // mediaGallery({
    //     direct: [{url:'{{ "/assets/logo/badger_letters_logo.svg" | relative_url }}'}],
    //     namespace:'mediaGallery',
    //     container: '#containerMediaGallery',
    // });
</script>