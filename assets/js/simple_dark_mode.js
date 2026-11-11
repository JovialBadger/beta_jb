---
---
// ==UserScript==
// @name        JB_Script_Simple_Dark_Mode
// @description Simple Dark Mode Toggle
// @version     0.1.0
// @namespace   Jovial-Badger_Scripts
// @match       *://*/*
// @author      Jovial Badger
// @downloadURL {{ site.url }}{{page.url | relative_url }}
// @updateURL   {{ site.url }}{{page.url | relative_url }}
// @homepageURL {{ site.url }}{{ "/" | relative_url }}
// @icon        {{ site.url }}{{ "/assets/logo/letters_logo.svg" | relative_url }}
// @run-at      document-end
// ==/UserScript==
/*
 * Simple Dark Mode — single-function, vanilla JS, fully patched
 * - Toggle dark mode on/off
 * - No external deps. Injected CSS only.
 *
 * Usage:
 *   simpleDarkMode({ /* options as in the const DEFAULTS = { ... } * / });
 */

function pageAlreadyLooksDark() {
  // Explicit dark theme markers
  if (
    document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark" ||
    document.body.classList.contains("dark")
  ) {
    return true;
  }

  // CSS color-scheme
  if (
    getComputedStyle(document.documentElement)
      .getPropertyValue("color-scheme")
      .includes("dark")
  ) {
    return true;
  }

  // Background luminance check
  const bg = getComputedStyle(document.body).backgroundColor;
  const rgb = bg.match(/\d+/g);

  if (rgb) {
    const [r, g, b] = rgb.map(Number);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    if (luminance < 0.35) return true;
  }

  return false;
}
(function () {
  // Inject styles
  const style = document.createElement("style");
  style.textContent = `
    /* Toggle button */
    #dark-mode-toggle {
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 999999;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 20px;
      background: #222;
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
    }

    /* Dark mode via inversion */
    html.dark-mode {
      filter: invert(1) hue-rotate(180deg);
      background: #eee;
    }

    /* Re-invert media so colours look normal */
    html.dark-mode img,
    html.dark-mode picture,
    html.dark-mode video,
    html.dark-mode canvas,
    html.dark-mode #dark-mode-toggle{
      filter: invert(1) hue-rotate(180deg);background-color:#333;
    }
    html.dark-mode picture img{filter:none;}
  `;
  document.head.appendChild(style);
  const pageIsDark = pageAlreadyLooksDark();
  // Create toggle button
  const button = document.createElement("button");
  button.id = "dark-mode-toggle";
  button.textContent = pageIsDark ? "☀️" : "🌙";
  button.title = "Toggle Dark Mode";

  // Restore saved state
  if ((localStorage.getItem("darkMode") === "true" || localStorage.getItem("darkMode") === null) && !pageIsDark) {
    document.documentElement.classList.add("dark-mode");
    button.textContent = !pageIsDark ? "☀️" : "🌙";
  }

  // Toggle handler
  button.addEventListener("click", () => {
    const enabled = document.documentElement.classList.toggle("dark-mode");
    button.textContent = enabled ? (!pageIsDark ? "☀️" : "🌙") : (pageIsDark ? "☀️" : "🌙");
    localStorage.setItem("darkMode", enabled);
  });

  document.body.appendChild(button);
})();