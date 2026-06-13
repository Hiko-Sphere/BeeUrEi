/* BeeUrEi 官网交互：语言 + 深浅色切换。零依赖、CSP 友好（外链 'self'）。
   置于 <head> 阻塞执行：先对 <html> 落定语言/主题，消除首屏闪烁；
   DOM 就绪后再接管按钮（按钮在 <body>，此时才存在）。 */
(function () {
  "use strict";
  var root = document.documentElement;
  var LS_LANG = "beeurei-lang", LS_THEME = "beeurei-theme";

  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // ---- 语言：本地存储 > 浏览器 > 中文 ----
  var lang = readLS(LS_LANG);
  if (lang !== "zh" && lang !== "en") {
    lang = (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  }
  function applyLang(l) {
    root.setAttribute("data-lang", l);
    root.setAttribute("lang", l === "en" ? "en" : "zh-Hans");
    var b = document.getElementById("langToggle");
    if (b) b.setAttribute("aria-pressed", l === "en" ? "true" : "false"); // pressed = 当前为英文
  }
  applyLang(lang); // 立即生效（在 <head> 阻塞阶段，body 尚未绘制）

  // ---- 主题：light | dark | null(跟随系统) ----
  var theme = readLS(LS_THEME);
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") {
      root.setAttribute("data-theme", mode);
      root.style.colorScheme = mode;
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "";
    }
    var b = document.getElementById("themeToggle");
    if (b) {
      var isDark = (mode === "light" || mode === "dark") ? mode === "dark" : prefersDark();
      b.setAttribute("aria-pressed", isDark ? "true" : "false");
    }
  }
  applyTheme(theme); // 立即生效

  // ---- DOM 就绪后接管控件 ----
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    applyLang(root.getAttribute("data-lang") === "en" ? "en" : "zh"); // 同步按钮 aria
    applyTheme(readLS(LS_THEME));

    var langBtn = document.getElementById("langToggle");
    if (langBtn) langBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-lang") === "en" ? "zh" : "en";
      applyLang(next); writeLS(LS_LANG, next);
    });

    var themeBtn = document.getElementById("themeToggle");
    if (themeBtn) themeBtn.addEventListener("click", function () {
      var cur = root.getAttribute("data-theme");
      if (cur !== "light" && cur !== "dark") cur = prefersDark() ? "dark" : "light";
      var next = cur === "dark" ? "light" : "dark";
      applyTheme(next); writeLS(LS_THEME, next);
    });

    var y = document.getElementById("year");
    if (y) y.textContent = String(new Date().getFullYear());
  });
})();
