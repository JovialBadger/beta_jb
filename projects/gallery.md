---
layout: default
title: Media_Gallery
category: Web_Scripts
order: 1
---
<div id='containerMediaGallery'></div>
<script src="{{ "/assets/js/gallery.js" | relative_url }}"></script>
<script>
    mediaGallery({
      namespace: 'mediaGallery',container:'#containerMediaGallery'
    });
</script>