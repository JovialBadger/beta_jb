---
---
  // ==UserScript==
  // @name        JB_Script_Media-Gallery
  // @description Media Gallery (single-function, vanilla JS)
  // @version     0.1
  // @namespace   Jovial-Badger_Scripts
  // @match       *://*/*
  // @grant       none
  // @author      Jovial Badger
  // @downloadURL {{ site.url }}{{page.url}}
  // @updateURL   {{ site.url }}{{page.url}}
  // @homepageURL {{ site.url }}
  // @icon        {{ site.url }}{{ "/assets/logo/letters_logo.svg" | relative_url }}
  // @run-at      document-end
  // ==/UserScript==

  /**
   * Media Gallery (single-function, vanilla JS)
   * - Overlay and inline gallery with thumbnails, controls, settings, persistence, and autoplay.
   * - No external deps. Injected CSS only. Clean, single-function implementation.
   *
   * Usage:
   *   mediaGallery({
   *     // Optional inline container (CSS selector or Element). If omitted, overlay-only mode.
   *     container: '#galleryContainer',
   *
   *     // Media extraction from DOM:
   *     // Array of { selector: string, attr?: 'src'|'href'|'data-*'|string }
   *     mediaSelectors: [
   *       { selector: 'img.article-image', attr: 'src' },
   *       { selector: 'a.lightbox', attr: 'href' },
   *     ],
   *
   *     // Optional thumbnail selectors; if omitted, main media URLs are used for thumbnails
   *     thumbSelectors: [
   *       { selector: 'img.article-image', attr: 'src' },
   *     ],
   *
   *     // Direct arrays (in addition to or instead of selectors)
   *     mediaUrls: [ 'https://example.com/img1.jpg', 'https://example.com/video.mp4' ],
   *     thumbUrls: [ 'https://example.com/thumb1.jpg', 'https://example.com/thumb2.jpg' ],
   *
   *     // Options (any omitted use defaults below)
   *     startIndex: 0,
   *     order: 'forwards', // 'forwards' | 'backwards' | 'random'
   *     hideThumbnails: false,
   *     enableDownload: true,
   *     enableShare: true,
   *     enableFullscreen: true,
   *     enableMetadataPanel: true,
   *     enableRotation: true,
   *     loopGallery: true,
   *     imageAutoAdvance: true,
   *     imageDelayMs: 4000,
   *
   *     videoAutoplay: true,
   *     videoMute: true,
   *     videoLoopCount: 0, // 0 = no loop before advancing
   *     videoAutoAdvance: true,
   *     videoAdvanceDelayMs: 1000,
   *
   *     idleTimeoutMs: 2500,
   *     addOpenButtonsNextToMedia: true,
   *
   *     // Optional: metadata override per-URL or id (map URL -> metadata object)
   *     metadataMap: {
   *       'https://example.com/img1.jpg': { title: 'Sunset', tags: ['nature'] },
   *     },
   *
   *     // Optional: provide a gallery id namespace (else derived from location.href)
   *     namespace: 'myGallery01',
   *   });
   */


  /**
   * Media Gallery — single-function, vanilla JS, fully patched
   * - Overlay + inline modes, thumbnails, rotation, download, fullscreen, share, settings, persistence.
   * - No external deps. Injected CSS only.
   *
   * Usage:
   *   mediaGallery({ /* options as in the original spec  });
   */
  function mediaGallery(userOptions = {}) {
    // --------- Configuration & Persistence ----------
    const DEFAULTS = {
      container: null, // selector or Element
      //mediaSelectors: [],
      //thumbSelectors: [],
      //mediaUrls: [],
      //thumbUrls: [],
      //metadataMap: {},
      media: [{ mediaSelector: { selector: 'img', attr: 'src' } }],
      direct: [],//{ url:x, thumb:z, meta:{}};

      startIndex: 0,
      order: 'forwards', // 'forwards' | 'backwards' | 'random'
      hideThumbnails: false,
      enableDownload: true,
      enableShare: true,
      enableFullscreen: true,
      enableMetadataPanel: false,
      enableRotation: true,
      loopGallery: false,
      imageAutoAdvance: true,
      imageDelayMs: 30000,

      videoAutoplay: true,
      videoMute: false,
      videoLoopCount: 1,
      videoAutoAdvance: true,
      videoAdvanceDelayMs: 2000,

      idleTimeoutMs: 0,
      addOpenButtonsNextToMedia: false,

      namespace: null,
    };

    const STORAGE_NS = `mg:${location.origin}${location.pathname}` + ':';
    const LS = {
      settings: (userOptions.namespace || DEFAULTS.namespace || STORAGE_NS) + 'settings',
      index: STORAGE_NS + 'index',
    };

    const savedSettings = safeParse(localStorage.getItem(LS.settings)) || {};
    const options = { ...DEFAULTS, ...userOptions, ...savedSettings };

    const isRandomOrder = options.order === 'random';
    const savedIndex = !isRandomOrder ? Number(localStorage.getItem(LS.index)) : NaN;
    if (Number.isFinite(savedIndex)) options.startIndex = savedIndex;

    // Persist so Settings reflects merged state
    persistSettings();

    // --------- Internal State ----------
    let state = {
      open: false,
      overlayMode: true,
      currentIndex: clamp(options.startIndex, 0, Infinity),
      orderMap: [],
      items: [],
      idleTimer: null,
      playing: options.imageAutoAdvance,
      rotationDeg: 0,
      videoLoopCounter: 0,
      fsActive: false,
      hidingUI: false,
    };

    // --------- Styles ----------
    injectStyles();

    // --------- Build media list ----------
    //const extracted = extractMediaFromPage(options.mediaSelectors, options.mediaUrls);
    //const thumbs = extractThumbsFromPage(options.thumbSelectors, options.thumbUrls, extracted);
    //const items = mergeMediaAndThumbs(extracted, thumbs, options.metadataMap);
    const items = extractGroupedSelectorsFromPage(options.media, options.direct);
    if (!items.length) return;


    function extractGroupedSelectorsFromPage(media, direct) {
      const results = [];
      media.forEach(m => {
        const _media = extractBySelectors(m.mediaSelector);
        var _thumb = [];
        if (m.thumbSelector) _thumb = extractBySelectors(m.thumbSelector);
        results.push(...mergeMediaAndThumbs(_media, _thumb.map(t => t.url), {}));
      });
      direct.forEach(d => {
        const type = detectType(d.url, null);
        results.push({ url: d.url, type: type, thumb: d.thumb || null, meta: d.meta || {}, sourceEl: null });
      });
      return results;
    }

    state.items = items;
    state.orderMap = buildOrderMap(items.length, options.order);
    state.currentIndex = clamp(options.startIndex, 0, state.orderMap.length - 1);

    // Inline container?
    const inlineContainer = resolveContainer(options.container);
    state.overlayMode = !inlineContainer;

    // --------- Build DOM ----------
    const dom = buildDOM(options);

    // Shared index via hash
    const sharedIndex = getSharedIndexFromURL();
    if (Number.isFinite(sharedIndex[0]) && sharedIndex[0] >= 0 && sharedIndex[0] < state.orderMap.length) {
      state.currentIndex = sharedIndex[0];
    }
    if (sharedIndex[1]) openGallery(true);
    // Initial render
    renderAll();
    // Open-in-gallery buttons near sources
    if (options.addOpenButtonsNextToMedia) attachOpenButtonsNearSources();



    // Mount inline if provided
    if (inlineContainer) mountInline(inlineContainer);

    // ================== Helpers ==================

    function safeParse(s) { try { return JSON.parse(s || ''); } catch { return null; } }
    function persistSettings() {
      // Save only serializable options, avoid DOM refs
      const toSave = {
        container: typeof options.container === 'string' ? options.container : null,
        //mediaSelectors: options.mediaSelectors,
        //thumbSelectors: options.thumbSelectors,
        //mediaUrls: options.mediaUrls,
        //thumbUrls: options.thumbUrls,
        media: options.media,
        direct: options.direct,
        //metadataMap: options.metadataMap,
        startIndex: options.startIndex,
        order: options.order,
        hideThumbnails: options.hideThumbnails,
        enableDownload: options.enableDownload,
        enableShare: options.enableShare,
        enableFullscreen: options.enableFullscreen,
        enableMetadataPanel: options.enableMetadataPanel,
        enableRotation: options.enableRotation,
        loopGallery: options.loopGallery,
        imageAutoAdvance: options.imageAutoAdvance,
        imageDelayMs: options.imageDelayMs,
        videoAutoplay: options.videoAutoplay,
        videoMute: options.videoMute,
        videoLoopCount: options.videoLoopCount,
        videoAutoAdvance: options.videoAutoAdvance,
        videoAdvanceDelayMs: options.videoAdvanceDelayMs,
        idleTimeoutMs: options.idleTimeoutMs,
        addOpenButtonsNextToMedia: options.addOpenButtonsNextToMedia,
        namespace: options.namespace,
      };
      localStorage.setItem(LS.settings, JSON.stringify(toSave));
    }
    function persistIndex() { if (!isRandomOrder) localStorage.setItem(LS.index, String(state.currentIndex)); }
    function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
    function resolveContainer(c) { if (!c) return null; if (typeof c === 'string') return document.querySelector(c); if (c instanceof Element) return c; return null; }

    function isYouTube(url) { return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/i.test(url); }
    function ytId(url) { const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/); return m ? m[1] : null; }
    function isVimeo(url) { return /vimeo\.com\/(?!channels|ondemand)/i.test(url) || /player\.vimeo\.com\/video\//i.test(url); }
    function vimeoId(url) { const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/) || url.match(/player\.vimeo\.com\/video\/(\d+)/); return m ? m[1] : null; }

    function extOf(url) {
      try {
        const u = new URL(url, location.href);
        const p = u.pathname.toLowerCase();
        const dot = p.lastIndexOf('.');
        return dot >= 0 ? p.slice(dot + 1) : '';
      } catch {
        const p = (url || '').toLowerCase();
        const q = p.split('?')[0];
        const dot = q.lastIndexOf('.');
        return dot >= 0 ? q.slice(dot + 1) : '';
      }
    }
    function detectType(url, sourceEl) {
      if (sourceEl && sourceEl.tagName === 'VIDEO') return 'video';
      if (sourceEl && sourceEl.tagName === 'IFRAME') return 'iframe';
      if (isYouTube(url)) return 'youtube';
      if (isVimeo(url)) return 'vimeo';
      const e = extOf(url);
      const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'];
      const vidExts = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv'];
      if (imgExts.includes(e)) return 'image';
      if (vidExts.includes(e)) return 'video';
      return 'image';
    }

    function extractBySelectors(pair) {
      const results = [];
      const selector = pair.selector || null;
      const attr = pair.attr || null;
      //if (!Array.isArray(pairs)) return results;
      //pairs.forEach(({ selector, attr }) => {
        if (!selector) return;
        const nodes = document.querySelectorAll(selector);
        nodes.forEach(el => {
          let url = null;
          if (!attr) {
            if (el instanceof HTMLImageElement) url = el.currentSrc || el.src;
            else if (el instanceof HTMLAnchorElement) url = el.href;
            else if (el instanceof HTMLVideoElement) {
              const srcEl = el.querySelector('source[src]') || el;
              url = srcEl.src || srcEl.getAttribute('src') || null;
            } else url = el.getAttribute('src') || el.getAttribute('href');
          } else {
            url = el.getAttribute(attr);
          }
          if (url) results.push({ url, sourceEl: el });
        });
      //});
      return results;
    }
    // function extractMediaFromPage(mediaSelectors, direct) {
    //   const s = extractBySelectors(mediaSelectors);
    //   const d = Array.isArray(direct) ? direct.map(u => ({ url: u, sourceEl: null })) : [];
    //   return [...s, ...d];
    // }
    // function extractThumbsFromPage(thumbSelectors, direct, mediaList) {
    //   if ((thumbSelectors && thumbSelectors.length) || (direct && direct.length)) {
    //     const s = extractBySelectors(thumbSelectors);
    //     const d = Array.isArray(direct) ? direct.map(u => ({ url: u })) : [];
    //     return [...s, ...d].map(x => x.url);
    //   }
    //   return mediaList.map(m => m.url);
    // }
    function mergeMediaAndThumbs(mediaList, thumbList, metadataMap) {
      return mediaList.map((m, i) => {
        const type = detectType(m.url, m.sourceEl);
        const thumb = thumbList[i] || m.url;
        const meta = metadataMap && metadataMap[m.url] ? metadataMap[m.url] : {};
        return { url: m.url, type, thumb, meta, sourceEl: m.sourceEl || null };
      });
    }
    function buildOrderMap(n, order) {
      const arr = Array.from({ length: n }, (_, i) => i);
      //if (order === 'backwards') return arr.reverse();
      //if (order === 'random') return shuffle(arr);
      return arr;
    }
    function shuffle(a) {
      const b = a.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      return b;
    }
    function handleQuery(index = -1) {
      const url = new URL(window.location.href);
      const shareMediaGallery = url.searchParams.get('shareMediaGallery');
      url.searchParams.delete('shareMediaGallery')
      if (index > -1) url.searchParams.set('mediaGallery', index);
      window.history.replaceState(null, '', url.toString());
      var urlIndex = url.searchParams.get('mediaGallery');
      return [Number(urlIndex === null ? -1 : urlIndex), !!shareMediaGallery];
    }
    function getSharedIndexFromURL() { return handleQuery(); }//const m = location.hash.match(/gallery=(\d+)/); return m ? Number(m[1]) : NaN;}
    function setShareIndexInURL(i) { if (!options.enableShare) return; const base = location.href.replace(location.hash, ''); const newHash = `#gallery=${i}`; history.replaceState(null, '', base + newHash); }
    function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function queryAll(sel) { return Array.from(document.querySelectorAll(sel)); }

    // --------- Styles (patched) ----------
    function injectStyles() {
      if (document.getElementById('mg-styles')) return;
      const css = `
    :root {
      --mg-bg: rgba(0,0,0,1);
      --mg-fg: #f4f4f6;
      --mg-dim: #c8c8d0;
      --mg-accent: #4ea1ff;
      --mg-danger: #ff5d6c;
      --mg-muted: #8b8b99;
      --mg-border: #000;
      --mg-thumb-h: 110px;
      --mg-toolbar-h: 52px;
      --mg-header-h: 40px;
      --mg-panel-w: 280px;
      --mg-gap: 8px;
      --mg-radius: 8px;
      --mg-btn-h: 36px;
      --mg-fixed-btn: 50px;
      --mg-z: 999999;
    }
    .mg-open-inline, .mg-pop-overlay{
	    border: 3px solid #333;
	    background: #292;
	    border-radius: 3px;
	    color: #eee;
      cursor:pointer;
    }
    .mg-inline .mg-media {
	    height: calc(100vh - var(--mg-header-h) - var(--mg-thumb-h) - 100px);
    }

    .mg-toggle-btn {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: var(--mg-z);
      background: var(--mg-accent);
      color: #fff;
      border: none;
      border-radius: 999px;
      height: var(--mg-fixed-btn);
      min-width: 120px;
      padding: 0 16px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      font: 600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      cursor: pointer;
    }
    .mg-toggle-btn.mg-hidden { opacity: 0; pointer-events: none; }

    .mg-overlay {
      position: fixed;
      inset: 0;
      background: var(--mg-bg);
      color: var(--mg-fg);
      display: none;
      flex-direction: column;
      z-index: var(--mg-z);
    }
    .mg-overlay.mg-open { display: flex; }

    .mg-inline {
      position: relative;
      width: 100%;
      min-height: 320px;
      background: #0f0f13;
      color: var(--mg-fg);
      border-radius: var(--mg-radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--mg-border);
    }

    .mg-header {
      height: var(--mg-header-h);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      border-bottom: 1px solid var(--mg-border);
      flex: 0 0 auto;
    }
    .mg-title { font: 600 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--mg-dim); }
    .mg-close {
      background: transparent;
      color: var(--mg-fg);
      border: 1px solid var(--mg-border);
      border-radius: 6px;
      height: 28px;
      padding: 0 10px;
      cursor: pointer;
    }
    .mg-inline .mg-close{display:none;}

    .mg-body {
      display: grid;
      grid-template-columns: 1fr var(--mg-panel-w);
      grid-template-rows: 1fr var(--mg-thumb-h);
      grid-template-areas:
        "media panel"
        "thumbs thumbs";
      gap: var(--mg-gap);
      padding: var(--mg-gap);
      flex: 1 1 auto;
      min-height: 0;
    }
    /* FIX: cleanly hide panel */
    .mg-no-panel .mg-body {
      grid-template-columns: 1fr;
      grid-template-areas:
        "media"
        "thumbs";
    }
    .mg-no-panel .mg-panel, .mg-idle .mg-panel {
      display:none;
    }
    /* FIX: cleanly hide thumbs */
    .mg-no-thumbs .mg-body {
      grid-template-rows: 1fr;
      grid-template-areas:
        "media panel";
    }
    .mg-no-thumbs .mg-thumbs, .mg-idle .mg-thumbs {
      display:none;
    }
    /* FIX: both hidden -> just media */
    .mg-no-thumbs.mg-no-panel .mg-body, .mg-idle .mg-body {
      grid-template-rows: 1fr;
      grid-template-columns: 1fr;
      grid-template-areas: "media";
    }

    .mg-media {
      grid-area: media;
      background: #000;
      border: 1px solid var(--mg-border);
      border-radius: var(--mg-radius);
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      /* FIX: prevent media overlapping toolbar */
      padding-bottom: var(--mg-toolbar-h);
      box-sizing: border-box;
    }
    .mg-media-content {
      max-width: 100%;
      /* FIX: account for toolbar height */
      max-height: calc(100% - var(--mg-toolbar-h));
      object-fit: contain;
      transform-origin: center center;
      transition: transform 0.2s ease;
      display: block;
    }
    .mg-media video.mg-media-content { background: #000; }
    .mg-iframe-wrap { width: 100%; height: 100%; }
    .mg-iframe-wrap iframe { width: 100%; height: 100%; border: 0; }
    .mg-prev, .mg-next{display:none;}
    .mg-toolbar {
      position: absolute;
      left: 3px;
      right: 3px;
      bottom: 0;
      height: var(--mg-toolbar-h);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(16,16,22,0.82);
      border: 1px solid var(--mg-border);
      border-radius: 10px;
      padding: 6px;
      backdrop-filter: blur(6px);
    }
    .mg-toolbar button {
      height: 32px;
      min-width: 32px;
      padding: 0 10px;
      color: var(--mg-fg);
      background: transparent;
      border: 1px solid var(--mg-border);
      border-radius: 6px;
      cursor: pointer;
    }
    .mg-toolbar button.mg-primary { background: var(--mg-accent); border-color: var(--mg-accent); color: #fff; }
    .mg-toolbar button.mg-danger { border-color: var(--mg-danger); color: #fff; background: var(--mg-danger); }
    .mg-spacer { flex: 1; }
    .mg-idx { color: var(--mg-dim); font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }

    .mg-thumbs {
      grid-area: thumbs;
      border: 1px solid var(--mg-border);
      border-radius: var(--mg-radius);
      overflow: hidden;
      background: #101018;
      display: flex;
      align-items: center;
    }
    .mg-thumbs-scroll {
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      display: flex;
      gap: 8px;
      padding: 8px;
      scroll-behavior: smooth;
    }
    .mg-thumb {
      width: 100px;
      height: 100px;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid transparent;
      flex: 0 0 auto;
      cursor: pointer;
    }
    .mg-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .mg-thumb.mg-active { border-color: var(--mg-accent); }

    .mg-panel {
      grid-area: panel;
      border: 1px solid var(--mg-border);
      border-radius: var(--mg-radius);
      padding: 10px;
      background: #0f0f15;
      overflow: auto;
      min-width: 0;
      font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .mg-panel h4 { margin: 6px 0 8px 0; font-size: 13px; color: var(--mg-dim); }
    .mg-panel .mg-row { margin-bottom: 6px; color: var(--mg-fg); }
    .mg-panel code { background: #15151c; padding: 1px 4px; border-radius: 4px; }

    .mg-settings {
      position: absolute;
      top: 6px;
      right: 6px;
      left: 6px;
      bottom: 6px;
      /*max-width: min(50vw, 450px);*/
      background: #141420dd;
      border: 1px solid var(--mg-border);
      border-radius: 10px;
      padding: 12px;
      z-index: 3;
      display: none;
      color: var(--mg-fg);
    }
    .mg-settings.mg-open { display: block; }
    .mg-settings h3 { margin: 0 0 8px 0; font: 700 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--mg-dim); }
    .mg-setting { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; }
    .mg-setting label { font-size: 12px; color: var(--mg-fg); }
    .mg-setting input[type="number"] { width: 100px; }
    .mg-settings .mg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: center; }

    .mg-idle .mg-header,
    .mg-idle .mg-toolbar,
    .mg-idle .mg-thumbs,
    .mg-idle .mg-panel {
      opacity: 0; pointer-events: none; display:none;
    }
    .mg-idle .mg-media{padding: 0;}
    .mg-idle .mg-media-content{max-height:100%;}
    .mg-idle .mg-toggle-btn { opacity: 0; pointer-events: none; }

    .mg-sr { position: absolute; left: -9999px; top: -9999px; height: 1px; width: 1px; overflow: hidden; }

    /*.mg-pop-overlay { position: absolute; top: 8px; left: 8px; z-index: 2; }*/

    @media (max-width: 800px) {
      .mg-body {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr var(--mg-thumb-h);
        grid-template-areas:
          "media"
          "thumbs";
      }
      .mg-panel { display: none !important; }
    }`;
      const style = document.createElement('style');
      style.id = 'mg-styles';
      style.textContent = css;
      document.head.appendChild(style);
      adjustBodyPaddingForToggle(true);
    }

    function adjustBodyPaddingForToggle(add) {
      const id = 'mg-body-pad-toggle';
      let marker = document.getElementById(id);
      if (add) {
        if (!marker) {
          marker = document.createElement('style');
          marker.id = id;
          marker.textContent = `body { padding-bottom: calc(var(--mg-fixed-btn) + 24px); }`;
          document.head.appendChild(marker);
        }
      } else {
        if (marker) marker.remove();
      }
    }

    // --------- DOM ----------
    function buildDOM() {
      // Toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'mg-toggle-btn';
      toggleBtn.textContent = 'Open gallery';
      document.body.appendChild(toggleBtn);

      // Overlay root
      const overlay = document.createElement('div');
      overlay.tabIndex = 0
      overlay.className = (inlineContainer) ? 'mg-inline' : 'mg-overlay mg-no-panel';

      if (inlineContainer) {
        inlineContainer.appendChild(overlay);
      } else {
        document.body.appendChild(overlay);
      }

      // Settings with close button (FIX: close from settings)
      const settings = document.createElement('div');
      settings.className = 'mg-settings';
      settings.innerHTML = `<button class="mg-close-settings" title="Close settings" style="float:right;">✕</button>`;
      settings.querySelector('.mg-close-settings').addEventListener('click', () => {
        settings.classList.remove('mg-open');
      });
      overlay.appendChild(settings);

      // Header
      const header = document.createElement('div');
      header.className = 'mg-header';
      header.innerHTML = `
      <div class="mg-title">Media Gallery</div>
      <span class="mg-idx"></span>
      <div>
        <button class="mg-close" title="Close gallery">Exit</button>
      </div>`;
      overlay.appendChild(header);

      // Body
      const body = document.createElement('div');
      body.className = 'mg-body';
      overlay.appendChild(body);

      // Media area
      const media = document.createElement('div');
      media.className = 'mg-media';
      body.appendChild(media);

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'mg-toolbar';
      toolbar.innerHTML = `
      <button class="mg-prev" title="Previous (←)">←</button>
      <button class="mg-next" title="Next (→)">→</button>
      <button class="mg-rotate-left" title="Rotate left">⟲</button>
      <button class="mg-rotate-right" title="Rotate right">⟳</button>
      <button class="mg-play" title="Play/Pause">Play</button>
      <button class="mg-download" title="Download">Download</button>
      <button class="mg-fullscreen" title="Fullscreen">Fullscreen</button>
      <button class="mg-share" title="Share link">Share</button>
      <span class="mg-spacer"></span>

      <button class="mg-settings-btn" title="Settings">Settings</button>
    `;//<span class="mg-idx"></span>
      media.appendChild(toolbar);

      // Thumbs
      const thumbs = document.createElement('div');
      thumbs.className = 'mg-thumbs';
      thumbs.innerHTML = `<div class="mg-thumbs-scroll"></div>`;
      body.appendChild(thumbs);

      // Panel
      const panel = document.createElement('div');
      panel.className = 'mg-panel';
      body.appendChild(panel);

      // ARIA helper
      const sr = document.createElement('div');
      sr.className = 'mg-sr';
      sr.textContent = 'Use left/right arrows to navigate.';
      overlay.appendChild(sr);

      // Inline pop overlay button
      const popOverlayBtn = document.createElement('button');
      popOverlayBtn.className = 'mg-pop-overlay';
      popOverlayBtn.textContent = 'Open As Overlay';
      //popOverlayBtn.style.display = 'none';
      popOverlayBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openGallery(true);
      });
      if (inlineContainer) header.prepend(popOverlayBtn);

      // Events
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.open) closeGallery();
        else openGallery(true);
      });
      header.querySelector('.mg-close').addEventListener('click', (e) => {
        e.preventDefault(); closeGallery();
      });

      toolbar.querySelector('.mg-prev').addEventListener('click', prev);
      toolbar.querySelector('.mg-next').addEventListener('click', next);
      toolbar.querySelector('.mg-rotate-left').addEventListener('click', () => rotate(-90));
      toolbar.querySelector('.mg-rotate-right').addEventListener('click', () => rotate(90));
      toolbar.querySelector('.mg-play').addEventListener('click', togglePlayPause);
      toolbar.querySelector('.mg-download').addEventListener('click', onDownload);
      toolbar.querySelector('.mg-fullscreen').addEventListener('click', onFullscreen);
      toolbar.querySelector('.mg-share').addEventListener('click', onShare);
      toolbar.querySelector('.mg-settings-btn').addEventListener('click', () => settings.classList.toggle('mg-open'));
      overlay.addEventListener('keydown', (e) => {
        if (!state.open && !inlineContainer) return;
        // Support multiple key combos
        const key = e.key.toLowerCase();
        const ctrl = e.ctrlKey;
        const alt = e.altKey;
        const shift = e.shiftKey;

        // Arrow navigation
        if (key === 'arrowleft' && ctrl) { e.preventDefault(); prev(); }
        else if (key === 'arrowright' && ctrl) { e.preventDefault(); next(); }

        // Fullscreen: F or Ctrl+F
        //else if (key === 'f' && (!ctrl && !alt && !shift)) { e.preventDefault(); onFullscreen(); }
        else if (key === 'f' && ctrl) { e.preventDefault(); onFullscreen(); }

        // Play/Pause: Space or Ctrl+P
        //else if (key === ' ' && (!ctrl && !alt && !shift)) { e.preventDefault(); togglePlayPause(); }
        else if (key === 'p' && ctrl) { e.preventDefault(); togglePlayPause(); }

        // Rotate: Ctrl+R (right), Ctrl+Shift+R (left)
        else if (key === 'r' && ctrl && !shift) { e.preventDefault(); rotate(90); }
        else if (key === 'r' && ctrl && shift) { e.preventDefault(); rotate(-90); }

        // Download: Ctrl+D
        else if (key === 'd' && ctrl) { e.preventDefault(); onDownload(); }

        // Share: Ctrl+S
        else if (key === 's' && ctrl) { e.preventDefault(); onShare(); }

        // Settings: Ctrl+,
        else if (key === ',' && ctrl) { e.preventDefault(); dom.settings.classList.toggle('mg-open'); }
      });
      // overlay.addEventListener('keydown', (e) => {
      //   if (!state.open && !inlineContainer) return;
      //   if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      //   else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      //   else if (e.key.toLowerCase() === 'f') { e.preventDefault(); onFullscreen(); }
      //   else if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
      //   //resetIdle();
      // });

      ['mousemove', 'mousedown', 'touchstart', 'wheel'].forEach(ev => {//,'keydown'
        overlay.addEventListener(ev, () => { if (state.open || inlineContainer) resetIdle(); }, { passive: true });
      });

      document.addEventListener('fullscreenchange', () => {
        state.fsActive = !!document.fullscreenElement;
        updateToolbarStates();
      });

      rebuildThumbnails(thumbs.querySelector('.mg-thumbs-scroll'));

      return { overlay, header, body, media, toolbar, thumbs, panel, toggleBtn, settings, popOverlayBtn };
    }

    function mountInline(containerEl) {
      return;
    }

    // --------- Thumbnails ----------
    function rebuildThumbnails(scrollEl) {
      scrollEl.innerHTML = '';
      state.orderMap.forEach((origIdx, dispIdx) => {
        const item = state.items[origIdx];
        const el = document.createElement('div');
        el.className = 'mg-thumb';
        el.title = item.meta?.title || '';
        const img = document.createElement('img');
        img.src = item.thumb || item.url;
        img.alt = item.meta?.title || `Item ${dispIdx + 1}`;
        el.appendChild(img);
        el.addEventListener('click', () => {
          state.currentIndex = dispIdx;
          state.rotationDeg = 0;
          state.videoLoopCounter = 0;
          renderAll();
        });
        scrollEl.appendChild(el);
      });
      highlightActiveThumb();
      centerActiveThumb();
    }
    function highlightActiveThumb() {
      document.querySelectorAll('.mg-thumb.mg-active').forEach(n => n.classList.remove('mg-active'));
      const nodes = document.querySelectorAll('.mg-thumbs-scroll .mg-thumb');
      const el = nodes[state.currentIndex];
      if (el) el.classList.add('mg-active');
    }
    function centerActiveThumb() {
      const strips = document.querySelectorAll('.mg-thumbs-scroll');
      strips.forEach(strip => {
        const thumb = strip.children[state.currentIndex];
        if (!thumb) return;
        const left = thumb.offsetLeft - (strip.clientWidth / 2) + (thumb.clientWidth / 2);
        strip.scrollTo({ left, behavior: 'smooth' });
      });
    }

    // --------- Layout toggles ----------
    function setPanelVisibility() {
      const clsApply = options.enableMetadataPanel ? removeClass : addClass;
      clsApply(dom.overlay, 'mg-no-panel');
      //if (dom.inlineRoot) clsApply(dom.inlineRoot, 'mg-no-panel');
    }
    function setThumbsVisibility() {
      const applyHide = options.hideThumbnails ? addClass : removeClass;
      applyHide(dom.overlay, 'mg-no-thumbs');
      //if (dom.inlineRoot) applyHide(dom.inlineRoot, 'mg-no-thumbs');
    }
    function addClass(el, c) { el.classList.add(c); }
    function removeClass(el, c) { el.classList.remove(c); }

    // --------- Rendering ----------
    function renderAll() {
      //if (dom.inline?.media) renderMediaInto(dom.inline.media, dom.inline.panel, dom.inline.toolbar);
      renderMediaInto(dom.media, dom.panel, dom.toolbar);
      highlightActiveThumb();
      centerActiveThumb();
      updateIndexDisplay(dom.toolbar);
      //if (dom.inlineToolbar) updateIndexDisplay(dom.inlineToolbar);
      updateToolbarStates();
      persistIndex();
      handleQuery(state.currentIndex);
    }
    function currentItem() {
      const origIdx = state.orderMap[state.currentIndex];
      return state.items[origIdx];
    }
    function computeMediaTransform() { return `rotate(${state.rotationDeg}deg)`; }

    function renderMediaInto(mediaEl, panelEl, toolbarEl) {
      if (!mediaEl || !panelEl || !toolbarEl) return;
      const item = currentItem();
      mediaEl.querySelectorAll('.mg-media-content, .mg-iframe-wrap').forEach(n => n.remove());

      let node;
      if (item.type === 'image') {
        const img = document.createElement('img');
        img.className = 'mg-media-content';
        img.src = item.url;
        img.alt = item.meta?.title || '';
        img.style.transform = computeMediaTransform();
        img.addEventListener('load', () => {
          if (options.enableMetadataPanel) updatePanel(panelEl, item, { width: img.naturalWidth, height: img.naturalHeight });
        });
        node = img;
      } else if (item.type === 'video') {
        const vid = document.createElement('video');
        vid.className = 'mg-media-content';
        vid.src = item.url;
        vid.muted = !!options.videoMute;
        vid.controls = true;
        vid.playsInline = true;
        vid.style.transform = computeMediaTransform();
        if (options.videoAutoplay && (state.open || inlineContainer)) { vid.autoplay = true; vid.play().catch(() => { }); }
        let loops = 0;
        vid.addEventListener('ended', () => {
          loops++;
          if (options.videoLoopCount && loops < options.videoLoopCount) {
            vid.currentTime = 0;
            vid.play().catch(() => { });
          } else if (options.videoAutoAdvance) {
            setTimeout(next, options.videoAdvanceDelayMs || 0);
          }
        });
        vid.addEventListener('loadedmetadata', () => {
          if (options.enableMetadataPanel) updatePanel(panelEl, item, { width: vid.videoWidth, height: vid.videoHeight, duration: vid.duration });
        });
        node = vid;
      } else if (item.type === 'youtube') {
        const wrap = document.createElement('div');
        wrap.className = 'mg-iframe-wrap';
        const id = ytId(item.url);
        const iframe = document.createElement('iframe');
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.src = `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
        wrap.appendChild(iframe);
        node = wrap;
        if (options.enableMetadataPanel) updatePanel(panelEl, item, {});
      } else if (item.type === 'vimeo') {
        const wrap = document.createElement('div');
        wrap.className = 'mg-iframe-wrap';
        const id = vimeoId(item.url);
        const iframe = document.createElement('iframe');
        iframe.allow = 'autoplay; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.src = `https://player.vimeo.com/video/${id}`;
        wrap.appendChild(iframe);
        node = wrap;
        if (options.enableMetadataPanel) updatePanel(panelEl, item, {});
      } else {
        const img = document.createElement('img');
        img.className = 'mg-media-content';
        img.src = item.url;
        img.alt = item.meta?.title || '';
        img.style.transform = computeMediaTransform();
        node = img;
      }
      mediaEl.appendChild(node);

      // Auto-advance images when playing
      clearTimeout(mediaEl._imgTimer);
      if (item.type === 'image' && state.playing && options.imageAutoAdvance) {
        mediaEl._imgTimer = setTimeout(next, options.imageDelayMs);
      }
    }

    function updatePanel(panelEl, item, detected = {}) {
      if (!options.enableMetadataPanel) {
        panelEl.innerHTML = '';
        return;
      }
      const fname = (() => {
        try { return decodeURIComponent(new URL(item.url, location.href).pathname.split('/').pop() || ''); }
        catch { return (item.url.split('?')[0].split('/').pop()) || ''; }
      })();

      const lines = [];
      if (item.meta && Object.keys(item.meta).length) {
        Object.entries(item.meta).forEach(([k, v]) => {
          lines.push(`<div class="mg-row"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</div>`);
        });
      }
      if (fname) lines.push(`<div class="mg-row"><strong>File:</strong> <code>${escapeHtml(fname)}</code></div>`);
      if (detected.width && detected.height) lines.push(`<div class="mg-row"><strong>Dimensions:</strong> ${detected.width} × ${detected.height}</div>`);
      if (typeof detected.duration === 'number' && isFinite(detected.duration)) lines.push(`<div class="mg-row"><strong>Duration:</strong> ${Math.round(detected.duration)}s</div>`);
      lines.push(`<div class="mg-row"><strong>Type:</strong> ${escapeHtml(item.type)}</div>`);
      panelEl.innerHTML = `<h4>Info</h4>${lines.join('')}`;
    }

    function updateIndexDisplay(header) {//get input to work from all locations
      const text = `${state.currentIndex + 1} / ${state.orderMap.length}`;
      document.querySelector('.mg-idx').textContent = text;//toolbar.
    }

    function updateToolbarStates() {
      // Hide buttons entirely if feature disabled (FIX)
      const toggleVisibility = (selector, enabled) => {
        queryAll(selector).forEach(b => { b.style.display = enabled ? '' : 'none'; });
      };
      toggleVisibility('.mg-rotate-left', options.enableRotation);
      toggleVisibility('.mg-rotate-right', options.enableRotation);
      toggleVisibility('.mg-download', options.enableDownload);
      toggleVisibility('.mg-fullscreen', options.enableFullscreen);
      toggleVisibility('.mg-share', options.enableShare);

      // Play button state
      queryAll('.mg-play').forEach(b => {
        b.textContent = state.playing ? 'Pause' : 'Play';
        b.classList.toggle('mg-primary', state.playing);
      });

      // FS button label
      queryAll('.mg-fullscreen').forEach(b => {
        if (options.enableFullscreen) b.textContent = state.fsActive ? 'Exit FS' : 'Fullscreen';
      });

      // Idle class
      if (state.idleTimeoutMs < 5000) state.hidingUI = false;
      [dom.overlay, dom.inlineRoot].filter(Boolean).forEach(root => {
        if (state.hidingUI) root.classList.add('mg-idle');
        else root.classList.remove('mg-idle');
      });


      setThumbsVisibility();
      setPanelVisibility();

      dom.toggleBtn.textContent = state.open ? 'Close gallery' : 'Open gallery';
    }

    // --------- Controls ----------
    // Track viewed images by display index
    let viewedIndices = new Set();

    function goToRandomImage() {
      if (!state.orderMap.length) return;

      // If all images have been viewed, reset the viewed list
      if (viewedIndices.size >= state.orderMap.length) {
        viewedIndices.clear();
      }

      // Build a list of unviewed indices
      const unviewed = [];
      for (let i = 0; i < state.orderMap.length; i++) {
        if (!viewedIndices.has(i)) unviewed.push(i);
      }

      // Pick a random unviewed index
      const randomIdx = unviewed.length
        ? unviewed[Math.floor(Math.random() * unviewed.length)]
        : Math.floor(Math.random() * state.orderMap.length);

      // Mark as viewed
      viewedIndices.add(randomIdx);

      state.currentIndex = randomIdx;
      state.rotationDeg = 0;
      state.videoLoopCounter = 0;
      renderAll();
    }

    function prev(rev = false) {
      if (options.order === 'backwards' && rev) { prev(true); return; }
      if (options.order === 'random') { goToRandomImage(); return; }
      state.rotationDeg = 0;
      state.videoLoopCounter = 0;
      if (state.currentIndex > 0) state.currentIndex--;
      else if (options.loopGallery) state.currentIndex = state.orderMap.length - 1;
      renderAll();
    }
    function next(rev = false) {
      if (options.order === 'backwards' && rev) { prev(true); return; }
      if (options.order === 'random') { goToRandomImage(); return; }
      state.rotationDeg = 0;
      state.videoLoopCounter = 0;
      if (state.currentIndex < state.orderMap.length - 1) state.currentIndex++;
      else if (options.loopGallery) state.currentIndex = 0;
      if (!options.loopGallery && state.currentIndex === state.orderMap.length - 1) { return; }
      renderAll();
    }
    function rotate(delta) {
      if (!options.enableRotation) return;
      state.rotationDeg = (state.rotationDeg + delta) % 360;
      [dom.media, dom.inline?.media].filter(Boolean).forEach(m => {
        const el = m.querySelector('.mg-media-content');
        if (el) el.style.transform = computeMediaTransform();
      });
    }
    function togglePlayPause(forceState = "") {
      if (forceState === "Play") { state.playing = false }
      if (forceState === "Pause") { state.playing = true }
      state.playing = !state.playing;
      const vids = document.querySelectorAll('.mg-media video.mg-media-content');
      vids.forEach(v => { if (state.playing && options.videoAutoplay) v.play().catch(() => { }); else v.pause(); });
      updateToolbarStates();
    }

    let playingOnHide = false;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        playingOnHide = state.playing;
        togglePlayPause("Pause");
      } else if (playingOnHide) {
        // Page became visible! Resume playing if audio was "playing on hide"
        togglePlayPause("Play");
      }
    });

    async function onDownload(e) {
      if (e) e.preventDefault();
      if (!options.enableDownload) return;
      const item = currentItem();
      try {
        const blob = await fetch(item.url, { mode: 'cors' }).then(r => r.blob());
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        const name = item.url.split('?')[0].split('/').pop() || 'download';
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch {
        const a = document.createElement('a');
        a.href = item.url;
        a.setAttribute('download', '');
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }
    function onFullscreen() {
      if (!options.enableFullscreen) return;
      if (dom.overlay.classList.contains('mg-inline-return')) {
        closeGallery();
      }
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
        wakeLock.release()
          .then(() => {
            wakeLock = null;
          })
        return;
      }
      if (!dom.overlay.classList.contains('mg-open')) {
        openGallery();
        dom.overlay.classList.add('mg-inline-return');
      }
      dom.overlay.requestFullscreen?.();
      requestWakeLock()
    }

    // create a reference for the wake lock
    let wakeLock = null;

    // create an async function to request a wake lock
    const requestWakeLock = async () => {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) { }
    } // requestWakeLock()

    function onShare() {
      if (!options.enableShare) return;
      //setShareIndexInURL(state.currentIndex);
      const url = new URL(window.location.href);
      url.searchParams.set('shareMediaGallery', '1')
      //const url = location.href;
      navigator.clipboard?.writeText(url).catch(() => { });
      queryAll('.mg-share').forEach(b => { b.classList.add('mg-primary'); setTimeout(() => b.classList.remove('mg-primary'), 500); });
    }

    // --------- Idle hide ----------
    function resetIdle() {
      //if (!state.open) return;
      clearTimeout(state.idleTimer);
      state.hidingUI = false;
      updateToolbarStates();
      if (options.idleTimeoutMs > 5000) {
        state.idleTimer = setTimeout(() => { state.hidingUI = true; updateToolbarStates(); }, options.idleTimeoutMs);
      }
    }

    // --------- Open/Close ----------
    function openGallery(focusOverlay = true) {
      state.open = true;
      dom.overlay.classList.remove('mg-inline');
      dom.overlay.classList.add('mg-overlay');
      dom.overlay.classList.add('mg-open');
      dom.popOverlayBtn.style.display = 'none';
      dom.toggleBtn.style.display = 'none';
      dom.toggleBtn.textContent = 'Close gallery';
      if (focusOverlay) dom.overlay.focus?.();
      renderAll();
      resetIdle();
    }
    function closeGallery() {
      state.open = false;
      dom.overlay.classList.remove('mg-open');
      dom.overlay.classList.remove('mg-inline-return');
      dom.popOverlayBtn.style.display = '';
      if (inlineContainer) {
        dom.overlay.classList.remove('mg-overlay');
        dom.overlay.classList.add('mg-inline');
      }
      dom.toggleBtn.style.display = '';
      dom.toggleBtn.textContent = 'Open gallery';
      //clearTimeout(state.idleTimer);
      state.hidingUI = false;
      updateToolbarStates();

      // Stop media playback (FIX)
      document.querySelectorAll('.mg-media video').forEach(v => { v.pause(); v.currentTime = 0; });
      document.querySelectorAll('.mg-media iframe').forEach(f => {
        const src = f.src;
        f.src = ''; // unload
        // restore src only when reopening during render; leave blank to fully stop now
      });
      if (document.fullscreenElement) { document.exitFullscreen?.(); }
    }

    // --------- Open buttons near source media ----------
    function attachOpenButtonsNearSources() {
      document.querySelectorAll('.mg-open-inline').forEach(n => n.remove());
      state.items.forEach((it, origIdx) => {
        if (!it.sourceEl) return;
        const btn = document.createElement('button');
        btn.className = 'mg-open-inline';
        btn.textContent = 'Open in gallery';
        //btn.style.all = 'unset';
        //btn.style.cursor = 'pointer';
        //btn.style.color = 'var(--mg-accent)';
        //btn.style.marginLeft = '8px';
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const displayIdx = state.orderMap.indexOf(origIdx);
          if (displayIdx >= 0) { state.currentIndex = displayIdx; openGallery(true); }
        });
        if (it.sourceEl instanceof HTMLAnchorElement) {
          it.sourceEl.addEventListener('click', (e) => { e.preventDefault(); });
        }
        it.sourceEl.insertAdjacentElement('afterend', btn);
      });
    }

    // --------- Settings UI ----------
    buildSettingsUI();

    function buildSettingsUI() {
      const s = dom.settings;
      const h = (html) => { const wrap = document.createElement('div'); wrap.innerHTML = html.trim(); return wrap.firstElementChild; };
      s.appendChild(h(`<h3>Settings</h3>`));

      const grid = document.createElement('div');
      grid.className = 'mg-grid';

      const bools = [
        ['imageAutoAdvance', 'Auto advance images'],
        ['videoAutoplay', 'Autoplay video'],
        ['videoMute', 'Mute video'],
        ['videoAutoAdvance', 'Auto-advance after video'],
        ['enableRotation', 'Rotation available'],
        ['hideThumbnails', 'Hide thumbnails'],
        ['addOpenButtonsNextToMedia', 'Open button beside original media'],
        ['enableDownload', 'Download button'],
        ['enableShare', 'Share link button'],
        ['enableFullscreen', 'Fullscreen button'],
        ['enableMetadataPanel', 'Metadata panel'],
        ['loopGallery', 'Loop whole gallery'],
      ];
      bools.forEach(([key, label]) => {
        grid.appendChild(h(`<div class="mg-setting"><label>${label}</label><input type="checkbox" data-key="${key}"></div>`));
      });

      const nums = [
        ['idleTimeoutMs', 'Idle timeout (ms)'],
        ['imageDelayMs', 'Image delay (ms)'],
        ['videoLoopCount', 'Video loop count'],
        ['videoAdvanceDelayMs', 'Video advance delay (ms)']
      ];
      nums.forEach(([key, label]) => {
        grid.appendChild(h(`<div class="mg-setting"><label>${label}</label><input type="number" data-key="${key}" step="100" min="0"></div>`));
      });

      grid.appendChild(h(`<div class="mg-setting"><label>Order</label>
      <select data-key="order">
        <option value="forwards">Forwards</option>
        <option value="backwards">Backwards</option>
        <option value="random">Random</option>
      </select></div>`));

      s.appendChild(grid);

      const adv = document.createElement('div');
      adv.className = 'mg-advanced';
      adv.innerHTML = `
      <h3>Media sources</h3>
      <div class="mg-setting">
        <label>Add media selector (css|attr)</label>
        <input type="text" placeholder=".gallery img|src" data-add="media">
        <br>
      <!--</div>
      <div class="mg-setting">-->
        <label>Add thumb selector (css|attr)</label>
        <input type="text" placeholder=".gallery img|src" data-add="thumbs">
        <!--<button class="mg-add-thumbs">Add</button>-->
        <button class="mg-add-media">Add</button>
      </div>
      <div class="mg-setting">
        <button class="mg-apply-now mg-primary">Apply changes</button>
        <button class="mg-reset mg-danger">Clear settings</button>
      </div>
    `;
      s.appendChild(adv);

      // List current media/thumbnail selectors with delete buttons
      const mediaListDiv = document.createElement('div');
      mediaListDiv.className = 'mg-setting';
      mediaListDiv.innerHTML = `<label>Current media/thumbnail selectors:</label>`;
      options.media.forEach((m, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.style.display = 'flex';
        itemDiv.style.alignItems = 'center';
        itemDiv.style.gap = '8px';

        let mediaDesc = '';
        if (Array.isArray(m.mediaSelector)) {
          mediaDesc = m.mediaSelector.map(ms => `${ms.selector}${ms.attr ? '|' + ms.attr : ''}`).join(', ');
        }
        let thumbDesc = '';
        if (Array.isArray(m.thumbSelector)) {
          thumbDesc = m.thumbSelector.map(ts => `${ts.selector}${ts.attr ? '|' + ts.attr : ''}`).join(', ');
        }
        itemDiv.innerHTML = `<span style="font-size:12px;">
      <strong>Media:</strong> ${mediaDesc || '<em>none</em>'}
      ${thumbDesc ? `<strong>Thumbs:</strong> ${thumbDesc}` : ''}
      </span>`;
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'mg-danger';
        delBtn.style.fontSize = '12px';
        delBtn.addEventListener('click', () => {
          options.media.splice(idx, 1);
          console.log(options.media);
          onSettingsChanged(true);
          itemDiv.remove();
        });
        itemDiv.appendChild(delBtn);
        mediaListDiv.appendChild(itemDiv);
      });
      s.appendChild(mediaListDiv);



      // Reflect current settings
      grid.querySelectorAll('input[type="checkbox"]').forEach(inp => {
        const k = inp.dataset.key; inp.checked = !!options[k];
        inp.addEventListener('change', () => { options[k] = inp.checked; onSettingsChanged(true); });
      });
      grid.querySelectorAll('input[type="number"]').forEach(inp => {
        const k = inp.dataset.key; inp.value = Number(options[k]) || 0;
        inp.addEventListener('change', () => { options[k] = Number(inp.value); onSettingsChanged(true); });
      });
      const orderSel = grid.querySelector('select[data-key="order"]');
      orderSel.value = options.order;
      orderSel.addEventListener('change', (e) => { options.order = e.target.value; onSettingsChanged(true); });

      adv.querySelector('.mg-add-media').addEventListener('click', () => {
        const inp = adv.querySelector('input[data-add="media"]');
        const val = (inp.value || '').trim();
        inp.value = '';
        if (!val) return;
        const arr1 = val.split('|');
        const inp2 = adv.querySelector('input[data-add="thumbs"]');
        const val2 = (inp2.value || '').trim();
        const arr2 = val2.split('|');
        options.media.push({ mediaSelector: { selector: arr1[0], attr: arr1[1] || undefined }, thumbSelector: val2 ? { selector: arr2[0], attr: arr2[1] || undefined } : {} });
        inp2.value = '';
        onSettingsChanged(true);
      });

      adv.querySelector('.mg-apply-now').addEventListener('click', () => { onSettingsChanged(true); dom.settings.classList.remove('mg-open'); });
      adv.querySelector('.mg-reset').addEventListener('click', () => {
        localStorage.removeItem(LS.settings);
        localStorage.removeItem(LS.index);
        const current = state.currentIndex;
        Object.assign(options, DEFAULTS);
        options.startIndex = clamp(current, 0, state.orderMap.length - 1);
        persistSettings();
        reloadGalleryKeepIndex();
        dom.settings.classList.remove('mg-open');
      });
    }

    function onSettingsChanged(reload = false) {
      persistSettings();
      if (reload) {
        reloadGalleryKeepIndex();
        if (options.addOpenButtonsNextToMedia) attachOpenButtonsNearSources();
        else document.querySelectorAll('.mg-open-inline').forEach(n => n.remove());
      } else {
        updateToolbarStates();
        renderAll();
        if (options.addOpenButtonsNextToMedia) attachOpenButtonsNearSources();
        else document.querySelectorAll('.mg-open-inline').forEach(n => n.remove());
      }
    }

    function reloadGalleryKeepIndex() {
      //const extracted = extractMediaFromPage(options.mediaSelectors, options.mediaUrls);
      //const thumbs = extractThumbsFromPage(options.thumbSelectors, options.thumbUrls, extracted);
      //const items = mergeMediaAndThumbs(extracted, thumbs, options.metadataMap);
      const items = extractGroupedSelectorsFromPage(options.media, options.direct);

      if (!items.length) return;

      const prevIdx = clamp(state.currentIndex, 0, items.length - 1);
      state.items = items;
      state.orderMap = buildOrderMap(items.length, options.order);
      state.currentIndex = clamp(prevIdx, 0, state.orderMap.length - 1);

      document.querySelectorAll('.mg-thumbs-scroll').forEach(strip => rebuildThumbnails(strip));
      setPanelVisibility();
      setThumbsVisibility();
      renderAll();
    }

    // =============== End main function ===============
  }

const urlGallery = `{{ site.default_site_url }}`;
if (typeof site !== 'undefined') {
  if (!window.location.href.includes(urlGallery)) {
    mediaGallery({
      namespace: 'mediaGallery',
    });
  }
}