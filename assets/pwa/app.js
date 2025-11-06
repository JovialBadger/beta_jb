---
---
// Minimal vanilla JS to register the service worker (required for PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('{{ "/assets/pwa/sw.js" | relative_url }}').catch(() => {});
}