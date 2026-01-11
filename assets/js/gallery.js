---
---
// ==UserScript==
// @name        JB_Script_Media-Gallery
// @description Media Gallery (single-function, vanilla JS)
// @version     0.1.9
// @namespace   Jovial-Badger_Scripts
// @match       *://*/*
// @grant       none
// @author      Jovial Badger
// @downloadURL {{ site.url }}{{page.url | relative_url }}
// @updateURL   {{ site.url }}{{page.url | relative_url }}
// @homepageURL {{ site.url }}{{ "/" | relative_url }}
// @icon        {{ site.url }}{{ "/assets/logo/letters_logo.svg" | relative_url }}
// @run-at      document-end
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_listValues
// @grant       GM_deleteValue
// ==/UserScript==
/*
 * Media Gallery — single-function, vanilla JS, fully patched
 * - Overlay + inline modes, thumbnails, rotation, download, fullscreen, share, settings, persistence.
 * - No external deps. Injected CSS only.
 *
 * Usage:
 *   mediaGallery({ /* options as in the const DEFAULTS = { ... } * / });
 */
function isUserScript() { return typeof GM_setValue === "function" }
function mediaGallery(userOptions = {}) {
  // --------- Configuration & Persistence ----------
  const DEFAULTS = {
    container: null, // selector or Element
    direct: [],//{ url:url, thumb:url, meta:{}};
    media: [],//DOM scraping  { mediaSelector: { selector:'img', attr:'src' }, thumbSelector: { selector:'img.thumb', attr:'src' } , metaMap: { url: { key: value }}};

    startIndex: 0,
    order: 'forwards', // 'forwards' | 'backwards' | 'random'
    hideThumbnails: false,
    enableDownload: true,
    enableShare: true,
    enableFullscreen: true,
    enableMetadataPanel: false,
    enableRotation: true,
    enableDefaultVideoControls: true,
    loopGallery: false,
    imageAutoAdvance: true,
    imageDelayMs: 30000,
    stopBackgroundPlayback: true,

    videoAutoplay: false,
    videoMute: false,
    videoLoopCount: 1,
    videoAutoAdvance: true,
    videoAdvanceDelayMs: 2000,

    audioAutoplay: true,
    audioMute: false,
    audioLoopCount: 0,
    audioAutoAdvance: true,
    audioAdvanceDelayMs: 800,

    idleTimeoutMs: 0,
    addOpenButtonsNextToMedia: false,
    allowUserSettings: (isUserScript() ? true : false),
    namespace: null,
  };
  let _imgTimer;
  const STORAGE_NS = `mg:${location.origin}${location.pathname}` + ':';
  const LS = {
    settings: (userOptions.namespace || DEFAULTS.namespace || STORAGE_NS) + 'settings',
    index: STORAGE_NS + 'index',
  };

  const defaultOverride = isUserScript() ? (safeParse(GM_getValue("defaultOverride")) || {}) : {};
  const savedSettings = safeParse(localStorage.getItem(LS.settings)) || {};
  const options = { ...DEFAULTS, ...defaultOverride, ...userOptions, ...savedSettings };
  if (options.order !== 'random') {
    const savedIndex = Number(localStorage.getItem(LS.index));
    const gmIndex = isUserScript() ? Number(GM_getValue(LS.index)) : NaN;
    if (Number.isFinite(savedIndex) && (savedIndex>0)) {options.startIndex = savedIndex;}
    else if (Number.isFinite(gmIndex) && (gmIndex>0)) {options.startIndex = gmIndex;}
    console.log("Restored gallery index: GM:", gmIndex,"Local:", savedIndex,"Restored:", options.startIndex);
  }
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
  let items = extractGroupedSelectorsFromPage(options.media, options.direct);
  if (!items.length) items = extractGroupedSelectorsFromPage([
    { mediaSelector: { selector: 'img', attr: 'src' } },
    { mediaSelector: { selector: 'video source', attr: 'src' } },
    { mediaSelector: { selector: 'audio source', attr: 'src' } }
  ]);
  if (!items.length) return;

  function extractGroupedSelectorsFromPage(media, direct=[]) {
    const results = [];
    media.forEach(m => {
      const _media = extractBySelectors(m.mediaSelector);
      var _thumb = [];
      if (m.thumbSelector) _thumb = extractBySelectors(m.thumbSelector);
      results.push(...mergeMediaAndThumbs(_media, _thumb.length > 0 ? _thumb.map(t => t.url) : [], {}));
    });
    direct.forEach(d => {
      const type = detectType(d.url, null);
      results.push({ url: d.url, type: type, thumb: d.thumb || null, meta: d.meta || {}, sourceEl: null });
    });
    return results;
  }

  state.items = items;
  state.orderMap = buildOrderMap(items.length);
  state.currentIndex = clamp(options.startIndex, 0, state.orderMap.length - 1);

  // Inline container?
  const inlineContainer = resolveContainer(options.container);
  state.overlayMode = !inlineContainer;

  // --------- Build DOM ----------
  const dom = buildDOM(options);

  // Shared index via hash
  const sharedIndex = handleQuery();
  if (Number.isFinite(sharedIndex[0]) && sharedIndex[0] >= 0 && sharedIndex[0] < state.orderMap.length) {
    state.currentIndex = sharedIndex[0];
  }
  if (sharedIndex[1]) openGallery(true);
  // Initial render
  renderAll();
  // Open-in-gallery buttons near sources
  if (options.addOpenButtonsNextToMedia) attachOpenButtonsNearSources();

  // ================== Helpers ==================
  function safeParse(s) { try { return JSON.parse(s || ''); } catch { return null; } }
  function persistSettings(saveGlobalOverride = false) {
    // Save only serializable options, avoid DOM refs
    const toSave = {
      container: typeof options.container === 'string' ? options.container : null,
      //startIndex: options.startIndex,
      order: options.order,
      hideThumbnails: options.hideThumbnails,
      enableDownload: options.enableDownload,
      enableShare: options.enableShare,
      enableFullscreen: options.enableFullscreen,
      enableMetadataPanel: options.enableMetadataPanel,
      enableRotation: options.enableRotation,
      enableDefaultVideoControls: options.enableDefaultVideoControls,
      loopGallery: options.loopGallery,
      imageAutoAdvance: options.imageAutoAdvance,
      imageDelayMs: options.imageDelayMs,
      stopBackgroundPlayback: options.stopBackgroundPlayback,

      videoAutoplay: options.videoAutoplay,
      videoMute: options.videoMute,
      videoLoopCount: options.videoLoopCount,
      videoAutoAdvance: options.videoAutoAdvance,
      videoAdvanceDelayMs: options.videoAdvanceDelayMs,


      audioAutoplay: options.audioAutoplay,
      audioMute: options.audioMute,
      audioLoopCount: options.audioLoopCount,
      audioAutoAdvance: options.audioAutoAdvance,
      audioAdvanceDelayMs: options.audioAdvanceDelayMs,

      idleTimeoutMs: options.idleTimeoutMs,
      addOpenButtonsNextToMedia: options.addOpenButtonsNextToMedia,
      namespace: options.namespace,
    };
    if (isUserScript() && saveGlobalOverride) GM_setValue("defaultOverride", JSON.stringify(toSave));
    const clone = structuredClone(toSave);

    clone.media = options.media;
    clone.direct = options.direct;
    localStorage.setItem(LS.settings, JSON.stringify(clone));
  }
  function persistIndex() { 
    if (options.order !== 'random') {
      localStorage.setItem(LS.index, String(state.currentIndex)); 
      if (isUserScript()) GM_setValue(LS.index, state.currentIndex);
    }
  }
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
    if (sourceEl && sourceEl.tagName === 'AUDIO') return 'audio'; // support <audio> source elements
    if (isYouTube(url)) return 'youtube';
    if (isVimeo(url)) return 'vimeo';
    const e = extOf(url);
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'];
    const vidExts = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv'];
    const audExts = ['mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus'];
    if (imgExts.includes(e)) return 'image';
    if (vidExts.includes(e)) return 'video';
    if (audExts.includes(e)) return 'audio'; // FIX: audio detection
    return 'image';
  }


  function extractBySelectors(pair) {
    const results = [];
    const selector = pair.selector || null;
    const attr = pair.attr || null;
    if (!selector) return [];
    const nodes = document.querySelectorAll(selector);
    nodes.forEach(el => {
      let url = null;
      if (!attr) {
        if (el instanceof HTMLImageElement) url = el.currentSrc || el.src;
        else if (el instanceof HTMLAnchorElement) url = el.href;
        else if (el instanceof HTMLVideoElement) {
          const srcEl = el.querySelector('source[src]') || el;
          url = srcEl.src || srcEl.getAttribute('src') || null;
        } else { url = el.getAttribute('src') || el.getAttribute('href'); }
        if (!url) {
          const bg = el.style.backgroundImage;
          if (bg && bg.includes("url(")) {
            url = bg.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
          }
        }
        if (!url) {
          const cs = getComputedStyle(el).backgroundImage;
          if (cs && cs.includes("url(")) {
            url = cs.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
          }
        }

      } else {
        url = el.getAttribute(attr);
        if (!url && attr === "background-image") {
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg.includes("url(")) {
            url = bg.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
          }
        }

      }
      if (url && !results.some(result => result.url.toLowerCase() === url.toLowerCase())) {
        results.push({ url, sourceEl: el });
      }
    });
    return results;
  }
  function mergeMediaAndThumbs(mediaList, thumbList, metadataMap) {
    return mediaList.map((m, i) => {
      const type = detectType(m.url, m.sourceEl);
      const thumb = thumbList[i] || m.url;
      const meta = metadataMap && metadataMap[m.url] ? metadataMap[m.url] : {};
      return { url: m.url, type, thumb, meta, sourceEl: m.sourceEl || null };
    });
  }
  function buildOrderMap(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
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
  function handleQuery() {
    const url = new URL(window.location.href);
    const shareMediaGallery = url.searchParams.get('shareMediaGallery');
    const urlIndex = url.searchParams.get('mediaGallery');
    url.searchParams.delete('shareMediaGallery');
    url.searchParams.delete('mediaGallery');
    //if (index > -1) url.searchParams.set('mediaGallery', index);
    window.history.replaceState(null, '', url.toString());
    return [Number(urlIndex === null ? -1 : urlIndex), !!shareMediaGallery];
  }
  //function getSharedIndexFromURL() { return handleQuery(); }//const m = location.hash.match(/gallery=(\d+)/); return m ? Number(m[1]) : NaN;}
  //function setShareIndexInURL(i) { if (!options.enableShare) return; const base = location.href.replace(location.hash, ''); const newHash = `#gallery=${i}`; history.replaceState(null, '', base + newHash); }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function queryAll(sel) { return Array.from(document.querySelectorAll(sel)); }



  function videoScrubber(options = {}) {
    const {
      videoSelector = 'video',
      previewSize = { width: 120, height: 90 }
    } = options;

    const galleryMedia = document.querySelector('.mg-media');
    const video = galleryMedia.querySelector(videoSelector);
    if (!video || !(video instanceof HTMLVideoElement)) return;

    // Inject styles
    if (!document.getElementById('vs-styles')) {
      const style = document.createElement('style');
      style.id = 'vs-styles';
      style.textContent = `
          .vs-container {
            position: relative;
            width: 100%;
            margin-top: 10px;
          }
          .vs-scrubber {
            width: 100%;
            height: 6px;
            background: #333;
            border-radius: 3px;
            cursor: pointer;
            position: relative;
            overflow: visible;
          }
          .vs-progress {
            height: 100%;
            background: var(--mg-accent, #4ea1ff);
            border-radius: 3px;
            width: 0%;
            transition: width 0.1s linear;
          }
          .vs-preview {
            position: absolute;
            bottom: 20px;
            left: 0;
            background: #000;
            border: 1px solid #555;
            border-radius: 4px;
            overflow: hidden;
            display: none;
            z-index: 10;
            pointer-events: none;
          }
          .vs-preview.vs-show {
            display: block;
          }
          .vs-preview canvas {
            display: block;
          }
          .vs-time {
            position: absolute;
            top: -25px;
            left: 0;
            font-size: 12px;
            color: #aaa;
            background: rgba(0,0,0,0.8);
            padding: 2px 6px;
            border-radius: 3px;
            white-space: nowrap;
          }
        `;
      document.head.appendChild(style);
    }

    const tempID = video.id + "_clonePreview";
    const prevTempVid = document.querySelector('#' + tempID);
    if (prevTempVid) prevTempVid.remove();

    const tempVid = video.cloneNode(true);
    tempVid.id = tempID;
    tempVid.muted = true;
    tempVid.style.display = 'none';
    document.body.appendChild(tempVid);

    const prevContainer = document.querySelector('.mg-body').querySelector('.vs-container');
    if (prevContainer) prevContainer.remove();
    // Build DOM
    const container = document.createElement('div');
    container.className = 'vs-container';
    container.innerHTML = `
        <div class="vs-scrubber">
          <div class="vs-progress"></div>
          <div class="vs-preview">
            <canvas></canvas>
            <div class="vs-time"></div>
          </div>
        </div>
      `;
    document.querySelector('.mg-body').prepend(container);
    //video.parentElement.insertBefore(container, video.nextSibling);

    const scrubber = container.querySelector('.vs-scrubber');
    const progress = container.querySelector('.vs-progress');
    const preview = container.querySelector('.vs-preview');
    const canvas = container.querySelector('canvas');
    const timeDisplay = container.querySelector('.vs-time');
    const ctx = canvas.getContext('2d');

    canvas.width = previewSize.width;
    canvas.height = previewSize.height;

    let thumbnails = [];
    //let isHovering = false;


    function showPreview(time, pageX) {
      if (!isFinite(time)) return;
      try {
        tempVid.currentTime = time;
        tempVid.onseeked = () => {
          try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(tempVid, 0, 0, canvas.width, canvas.height);
            // position preview relative to wrapper
            const wrapRect = container.getBoundingClientRect();
            const sendondHalf = (time / tempVid.duration) > 0.5;
            const x = clamp((pageX - (sendondHalf ? canvas.width : 0)) - wrapRect.left, 40, wrapRect.width - 40);
            preview.style.left = x + 'px';

            preview.style.display = 'block';
          } catch (e) {
            preview.style.display = 'none';
          }
        };
      } catch (e) { preview.style.display = 'none'; }
    }
    function hidePreview() { preview.style.display = 'none'; }

    // Update progress bar on playback
    video.addEventListener('timeupdate', () => {
      const percent = (video.currentTime / video.duration) * 100;
      progress.style.width = percent + '%';
    });

    scrubber.addEventListener('mousemove', (ev) => {
      const rect = scrubber.getBoundingClientRect();
      const ratio = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const t = (video.duration || 0) * ratio;
      showPreview(t, ev.clientX);
    });
    scrubber.addEventListener('mouseleave', () => {
      hidePreview();
    });

    scrubber.addEventListener('click', (e) => {
      if (!video.duration) return;
      const rect = scrubber.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      video.currentTime = percent * video.duration;
    });
  }

  // Usage: videoScrubber({ videoSelector: '.mg-media video' });

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
    /*.mg-prev, .mg-next{display:none;}*/
    .mg-frame-left, .mg-frame-right ,.mg-mute{display:none;}
    .mg-toolbar.mg-vid-controls .mg-frame-left, .mg-toolbar.mg-vid-controls .mg-frame-right, .mg-toolbar.mg-vid-controls .mg-mute{display:block;}
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
    .mg-settings .mg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: center;max-height: 50%;overflow: auto;}

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
    }
      /* Audio visualiser canvas */
.mg-audio-vis {
  width: 100%;
  height: 80px;
  pointer-events: none;
  z-index: 2;
}
    `;
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
    settings.innerHTML = `<button class="mg-close-settings" title="Close settings" style="width:100%;">Close Settings</button>` + (isUserScript() ? `<button class="mg-saveas-default-settings" title="Save as default settings" style="width:100%;">Save as Default Settings</button>` : '');
    overlay.appendChild(settings);
    settings.querySelector('.mg-close-settings').addEventListener('click', () => {
      settings.classList.remove('mg-open');
    });
    settings.querySelector('.mg-saveas-default-settings').addEventListener('click', () => {
      persistSettings(true);
    });

    // Header
    const header = document.createElement('div');
    header.className = 'mg-header';
    header.innerHTML = `
      <div class="mg-title">Media Gallery</div>
      <span class="mg-idx"></span>
      <span class="mg-vid-time"></span>
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
      <button class="mg-rotate-left" title="Rotate left">⟲</button>
      <button class="mg-rotate-right" title="Rotate right">⟳</button>
      <button class="mg-prev" title="Previous (←)">←</button>
      <button class="mg-frame-left" title="Frame skip left">◁</button>
      <button class="mg-play" title="Play/Pause">▶︎</button>
      <button class="mg-frame-right" title="Frame skip right">▷</button>
      <button class="mg-next" title="Next (→)">→</button>
      <button class="mg-mute" title="Mute Toggle">🔈</button>
      <button class="mg-download" title="Download">🡣</button>
      <button class="mg-fullscreen" title="Fullscreen">⛶</button>
      <button class="mg-share" title="Share link">🔗</button>
      <span class="mg-spacer"></span>
      <button class="mg-settings-btn" ` + (options.allowUserSettings ? ``:`style="display:none"` ) + ` title="Settings">⚙</button>
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
    toolbar.querySelector('.mg-mute').addEventListener('click', () => toggleMute());
    toolbar.querySelector('.mg-frame-left').addEventListener('click', () => frameStep('-'));
    toolbar.querySelector('.mg-frame-right').addEventListener('click', frameStep);
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

  // --------- Thumbnails ----------
  function rebuildThumbnails(scrollEl) {
    scrollEl.innerHTML = '';
    state.orderMap.forEach((origIdx, dispIdx) => {
      const item = state.items[origIdx];
      const el = document.createElement('div');
      el.className = 'mg-thumb';
      el.title = item.meta?.title || '';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = item.thumb || item.url;
      img.alt = item.meta?.title || `Item ${dispIdx + 1}`;
      el.appendChild(img);
      el.addEventListener('click', () => {
        clearTimeout(_imgTimer);
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
  }
  function setThumbsVisibility() {
    const applyHide = options.hideThumbnails ? addClass : removeClass;
    applyHide(dom.overlay, 'mg-no-thumbs');
  }
  function addClass(el, c) { el.classList.add(c); }
  function removeClass(el, c) { el.classList.remove(c); }

  // --------- Rendering ----------
  function renderAll() {
    //if (dom.inline?.media) renderMediaInto(dom.inline.media, dom.inline.panel, dom.inline.toolbar);
    renderMediaInto(dom.media, dom.panel, dom.toolbar);
    highlightActiveThumb();
    centerActiveThumb();
    updateIndexDisplay();
    //if (dom.inlineToolbar) updateIndexDisplay(dom.inlineToolbar);
    updateToolbarStates();
    persistIndex();
    //handleQuery(state.currentIndex);
  }
  function currentItem() {
    const origIdx = state.orderMap[state.currentIndex];
    return state.items[origIdx];
  }
  function computeMediaTransform() { return `rotate(${state.rotationDeg}deg)`; }
  function setupAudioVisualiser(audioEl, canvas) {
    const ctx = canvas.getContext('2d');
    let audioCtx, analyser, dataArray, rafId;

    function resize() {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function start() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaElementSource(audioEl);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        src.connect(analyser);
        analyser.connect(audioCtx.destination);
      }
      draw();
    }

    function draw() {
      rafId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / dataArray.length) * 1.5;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255;
        const h = v * canvas.height;
        ctx.fillStyle = `rgba(78,161,255,${0.4 + v * 0.6})`;
        ctx.fillRect(x, canvas.height - h, barWidth, h);
        x += barWidth + 1;
      }
    }

    audioEl.addEventListener('play', start);
    audioEl.addEventListener('pause', () => cancelAnimationFrame(rafId));
    audioEl.addEventListener('ended', () => cancelAnimationFrame(rafId));

    // Cleanup when switching media
    audioEl.addEventListener('emptied', () => {
      cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close();
    });
  }
  function renderMediaInto(mediaEl, panelEl, toolbarEl) {
    if (!mediaEl || !panelEl || !toolbarEl) return;
    const item = currentItem();
    mediaEl.querySelectorAll('.mg-media-content, .mg-iframe-wrap').forEach(n => n.remove());
    toolbarEl.classList.remove('mg-vid-controls');
    document.querySelector('.mg-vid-time').textContent = ``;

    const prevContainer = document.querySelector('.mg-body').querySelector('.vs-container');
    if (prevContainer) prevContainer.remove();

    let node;
    if (item.type === 'video') {
      toolbarEl.classList.add('mg-vid-controls');
      const vid = document.createElement('video');
      vid.className = 'mg-media-content';
      vid.src = item.url;
      vid.muted = !!options.videoMute;
      const muteBtn = document.querySelector('.mg-toolbar .mg-mute');
      muteBtn.textContent = vid.muted ? '🔇' : '🔈';
      vid.controls = !!options.enableDefaultVideoControls;//true;
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
          _imgTimer = setTimeout(next, options.videoAdvanceDelayMs || 0);
        }
      });
      vid.addEventListener('loadedmetadata', () => {
        displayVideoTime(vid);
        //if (options.enableMetadataPanel) 
        updatePanel(panelEl, item, { width: vid.videoWidth, height: vid.videoHeight, duration: vid.duration });
      });
      vid.addEventListener('timeupdate', () => {
        displayVideoTime(vid);
      });
      
      node = vid;
    } else if (item.type === 'audio') {
      const wrap = document.createElement('div');
      //wrap.style.position = 'relative';
      wrap.style.width = '100%';
      //wrap.style.height = '100%';

      // --- Visualiser canvas ---
      const canvas = document.createElement('canvas');
      canvas.className = 'mg-audio-vis';
      wrap.appendChild(canvas);

      // --- Audio element ---
      const aud = document.createElement('audio');
      aud.className = 'mg-media-content';
      aud.src = item.url;
      aud.controls = true;
      aud.preload = 'metadata';
      aud.style.width = '100%';
      aud.style.maxHeight = '100%';
      aud.style.display = 'block';
      aud.muted = !!options.audioMute;

      wrap.appendChild(aud);
      node = wrap;

      // Autoplay
      if (options.audioAutoplay && state.open) {
        aud.autoplay = true;
        aud.play().catch(() => { });
      }

      // Metadata
      aud.addEventListener('loadedmetadata', () => {
        //if (options.enableMetadataPanel)
        updatePanel(panelEl, item, { duration: aud.duration });
      });

      // Auto-advance
      let loops = 0;
      aud.addEventListener('ended', () => {
        loops++;
        if (options.audioLoopCount && loops < options.audioLoopCount) {
          aud.currentTime = 0;
          aud.play().catch(() => { });
        } else if (options.audioAutoAdvance) {
          setTimeout(next, options.audioAdvanceDelayMs || 0);
        }
      });

      // --- AUDIO VISUALISER SETUP ---
      setupAudioVisualiser(aud, canvas);
    }
    else if (item.type === 'youtube') {
      const wrap = document.createElement('div');
      wrap.className = 'mg-iframe-wrap';
      const id = ytId(item.url);
      const iframe = document.createElement('iframe');
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.src = `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
      wrap.appendChild(iframe);
      node = wrap;
      //if (options.enableMetadataPanel)
      updatePanel(panelEl, item, {});
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
      //if (options.enableMetadataPanel) 
      updatePanel(panelEl, item, {});
    } else {//image and default
      const img = document.createElement('img');
      img.className = 'mg-media-content';
      img.src = item.url;
      img.alt = item.meta?.title || '';
      img.style.transform = computeMediaTransform();
      img.addEventListener('load', () => {
        //if (options.enableMetadataPanel) 
        updatePanel(panelEl, item, { width: img.naturalWidth, height: img.naturalHeight });
      });
      node = img;
    }
    mediaEl.appendChild(node);
    videoScrubber({ videoSelector: '.mg-media video' });
    // Auto-advance images when playing
    clearTimeout(_imgTimer);
    if (item.type === 'image' && state.playing && options.imageAutoAdvance) {
      _imgTimer = setTimeout(next, options.imageDelayMs);
    }
  }

  function updatePanel(panelEl, item, detected = {}) {
    const detected_keys = Object.keys(detected);
    detected_keys.forEach(key => {
      if (detected[key] !== undefined && detected[key] !== null) {
        item.meta[key] = detected[key];
      }
    });
    const origIdx = state.orderMap[state.currentIndex];
    state.items[origIdx] = item; // Update stored meta info
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
    //if (detected.width && detected.height) lines.push(`<div class="mg-row"><strong>Dimensions:</strong> ${detected.width} × ${detected.height}</div>`);
    //if (typeof detected.duration === 'number' && isFinite(detected.duration)) lines.push(`<div class="mg-row"><strong>Duration:</strong> ${Math.round(detected.duration)}s</div>`);
    lines.push(`<div class="mg-row"><strong>Type:</strong> ${escapeHtml(item.type)}</div>`);
    panelEl.innerHTML = `<h4>Info</h4>${lines.join('')}`;
  }

  function updateIndexDisplay() {//get input to work from all locations
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
      b.textContent = state.playing ? '⏸' : '▶︎';
      b.classList.toggle('mg-primary', state.playing);
    });

    // FS button label
    queryAll('.mg-fullscreen').forEach(b => {
      if (options.enableFullscreen) b.textContent = state.fsActive ? 'Exit FS' : '⛶';
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

  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function displayVideoTime(vid = null) {
    if (!vid || vid.paused) return;
    const current = fmtTime(vid.currentTime);
    const total = fmtTime(vid.duration) || 0;
    document.querySelector('.mg-vid-time').textContent = `${current} / ${total}`;
  }

  function prev(rev = false) {
    if (options.order === 'backwards' && !rev) { next(true); return; }
    if (options.order === 'random') { goToRandomImage(); return; }
    state.rotationDeg = 0;
    state.videoLoopCounter = 0;
    if (state.currentIndex > 0) state.currentIndex--;
    else if (options.loopGallery) state.currentIndex = state.orderMap.length - 1;
    renderAll();
  }
  function next(rev = false) {
    if (options.order === 'backwards' && !rev) { prev(true); return; }
    if (options.order === 'random') { goToRandomImage(); return; }
    if (!options.loopGallery && state.currentIndex === state.orderMap.length - 1) { return; }
    state.rotationDeg = 0;
    state.videoLoopCounter = 0;
    if (state.currentIndex < state.orderMap.length - 1) state.currentIndex++;
    else if (options.loopGallery) state.currentIndex = 0;
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
    document.querySelectorAll('.mg-media audio.mg-media-content').forEach(a => {
      if (state.playing && options.audioAutoplay) a.play().catch(() => { });
      else a.pause();
    });
    updateToolbarStates();
  }
  function toggleMute(mute = '-') {
    const vids = document.querySelectorAll('.mg-media video.mg-media-content');
    const muteBtn = document.querySelector('.mg-toolbar .mg-mute');
    vids.forEach(v => {
      const muted = mute !== '-' ? !!mute : !v.muted;
      v.muted = muted;
      muteBtn.textContent = muted ? '🔇' : '🔈';
    });
  }
  function frameStep(dir = '+') {
    togglePlayPause("Pause");
    state.playing = !state.playing;
    const vids = document.querySelectorAll('.mg-media video.mg-media-content');
    vids.forEach(v => {
      v.currentTime = Math.max(0, v.currentTime + ((1 / 30) * (dir == '-' ? -1 : 1)));
    });
  }

  let playingOnHide = false;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && options.stopBackgroundPlayback) {
      playingOnHide = state.playing;
      togglePlayPause("Pause");
    } else if (playingOnHide) {
      // Page became visible! Resume playing if audio was "playing on hide"
      togglePlayPause("Play");
    }
  });

  async function onDownloadAll(e) {
    if (e) e.preventDefault();
    if (!options.enableDownload) return;

    const downloadedUrls = new Set();
    const failedUrls = [];

    const metaKeys = new Set();
    
      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        if (item.meta && typeof item.meta === 'object') {
          Object.keys(item.meta).forEach(key => metaKeys.add(key));
        }

        // Skip if already downloaded
        if (downloadedUrls.has(item.url)) {
          console.log(`Skipped duplicate: ${item.url}`);
          continue;
        }
        const downloadSuccess = await onDownload(null, item);
        if (downloadSuccess) {
          downloadedUrls.add(item.url);
          console.log(`Downloaded: ${item.url}`);
        } else{
          failedUrls.push(item.url);
          console.warn(`Failed to download ${item.url}:`, err);
        }
      }
      console.log(`Download complete. Success: ${downloadedUrls.size}, Failed: ${failedUrls.length}`);

    const uniqueMetaKeys = Array.from(metaKeys);
    // Create CSV content
    const csvHeaders = ['URL', 'Status', 'Downloaded At', ...uniqueMetaKeys];
    const csvRows = [csvHeaders];

    state.items.forEach(item => {
      const status = downloadedUrls.has(item.url) ? 'Success' : (failedUrls.includes(item.url) ? 'Failed' : 'Skipped');
      const timestamp = downloadedUrls.has(item.url) ? new Date().toISOString() : '';
      const row = [item.url, status, timestamp];
      uniqueMetaKeys.forEach(key => {
        row.push(item.meta?.[key] ?? '');
      });
      csvRows.push(row);
    });

    const csvContent = csvRows.map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvLink = document.createElement('a');
    csvLink.href = csvUrl;
    csvLink.download = '_downloadLog.csv';
    document.body.appendChild(csvLink);
    csvLink.click();
    csvLink.remove();
    URL.revokeObjectURL(csvUrl);
      alert(`Downloaded ${downloadedUrls.size} files. ${failedUrls.length} failed.`);
  }

  // Download All button
  const downloadAllBtn = document.createElement('button');
  downloadAllBtn.className = 'mg-download-all';
  downloadAllBtn.textContent = 'Download All';
  downloadAllBtn.title = 'Download all media';
  downloadAllBtn.addEventListener('click', onDownloadAll);
  document.body.appendChild(downloadAllBtn);


  async function onDownload(e, passItem = null) {
    if (e) e.preventDefault();
    if (!options.enableDownload) return;
    const item = passItem || currentItem();
    try {
      function normalizeUrl(url) {
        return new URL(url, window.location.href).href;
      }     
      const blob = await fetch(normalizeUrl(item.url), { mode: 'cors' }).then(r => r.blob());
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      const name = item.url.split('?')[0].split('/').pop() || 'download';
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return true;
    } catch {
      const a = document.createElement('a');
      a.href = item.url;
      a.setAttribute('download', '');
      document.body.appendChild(a);
      a.click();
      a.remove();
      return false;
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
    url.searchParams.set('shareMediaGallery', '1');
    url.searchParams.set('mediaGallery', state.currentIndex.toString());
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
    //renderAll();
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
        if (displayIdx >= 0) { state.currentIndex = displayIdx; renderAll();openGallery(true); }
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
      ['audioAutoplay', 'Autoplay audio'],
      ['audioMute', 'Mute audio'],
      ['audioAutoAdvance', 'Auto-advance after audio'],
      ['enableRotation', 'Rotation available'],
      ['enableDefaultVideoControls', 'Default Video Controls'],
      ['hideThumbnails', 'Hide thumbnails'],
      ['addOpenButtonsNextToMedia', 'Open button beside original media'],
      ['enableDownload', 'Download button'],
      ['enableShare', 'Share link button'],
      ['enableFullscreen', 'Fullscreen button'],
      ['enableMetadataPanel', 'Metadata panel'],
      ['loopGallery', 'Loop whole gallery'],
      ['stopBackgroundPlayback', 'Pause on tab hide']
    ];
    bools.forEach(([key, label]) => {
      grid.appendChild(h(`<div class="mg-setting"><label>${label}</label><input type="checkbox" data-key="${key}"></div>`));
    });

    const nums = [
      ['idleTimeoutMs', 'Idle timeout (ms)'],
      ['imageDelayMs', 'Image delay (ms)'],
      ['videoLoopCount', 'Video loop count'],
      ['videoAdvanceDelayMs', 'Video advance delay (ms)'],
      ['audioLoopCount', 'Audio loop count'],
      ['audioAdvanceDelayMs', 'Audio advance delay (ms)']
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
      if (m.mediaSelector) {
        mediaDesc = m.mediaSelector.selector + (m.mediaSelector.attr ? ('|' + m.mediaSelector.attr) : '');
      }
      let thumbDesc = '';
      if (m.thumbSelector) {
        thumbDesc = m.thumbSelector.selector + (m.thumbSelector.attr ? ('|' + m.thumbSelector.attr) : '');
        //thumbDesc = m.thumbSelector.map(ts => `${ts.selector}${ts.attr ? '|' + ts.attr : ''}`).join(', ');
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
      if (isUserScript()) {GM_deleteValue(LS.index);}
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
    const items = extractGroupedSelectorsFromPage(options.media, options.direct);

    if (!items.length) return;

    const prevIdx = clamp(state.currentIndex, 0, items.length - 1);
    state.items = items;
    state.orderMap = buildOrderMap(items.length);
    state.currentIndex = clamp(prevIdx, 0, state.orderMap.length - 1);

    document.querySelectorAll('.mg-thumbs-scroll').forEach(strip => rebuildThumbnails(strip));
    setPanelVisibility();
    setThumbsVisibility();
    renderAll();
  }

  // =============== End main function ===============
}

const urlGallery = `{{ site.default_site_url }}`;
if (!window.location.href.includes(urlGallery)) {
  if (isUserScript()) {
    console.log("Media Gallery: Running as userscript");
    unsafeWindow.mediaGalleryGlobal = mediaGallery;
  } else {
    window.mediaGalleryGlobal = mediaGallery;
  }
}