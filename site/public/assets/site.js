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
  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // 仅在尊重动效时标记 reveal-ready；否则 CSS 不隐藏，内容直接可见（无 JS 同理）。
  if (!prefersReduced()) root.classList.add("reveal-ready");

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
  // 手动主题时同步移动端浏览器地址栏底色（theme-color）：HTML 里的两条 theme-color 用 media=
  // (prefers-color-scheme) 只跟**系统**深浅——用户手动切到与系统相反的主题时，页面已变、地址栏却没变
  // （深色系统下手动切浅色 → 内容浅、地址栏仍深，割裂）。用一条**无 media** 的 theme-color 插到 <head>
  // 最前覆盖（浏览器取首个 media 命中者）；跟随系统时撤掉，media 版本恢复接管（无 JS 时亦由 media 版兜底）。
  var THEME_COLORS = { light: "#f2a900", dark: "#14161f" };
  function applyThemeColor(mode) {
    var head = document.head, el = document.getElementById("tc-dynamic");
    if (mode === "light" || mode === "dark") {
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", "theme-color"); el.id = "tc-dynamic";
        head.insertBefore(el, head.firstChild); // 置首，优先于 media 版本
      }
      el.setAttribute("content", THEME_COLORS[mode]);
    } else if (el && el.parentNode) {
      el.parentNode.removeChild(el); // 跟随系统：撤覆盖，media 版本恢复
    }
  }
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") {
      root.setAttribute("data-theme", mode);
      root.style.colorScheme = mode;
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "";
    }
    applyThemeColor(mode);
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

    // 滚动渐显：进入视口即 .in；无 IO 支持时直接全部显示（兜底）。
    if (root.classList.contains("reveal-ready")) {
      var els = document.querySelectorAll(".reveal");
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
          });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
        els.forEach(function (el) { io.observe(el); });
      } else {
        els.forEach(function (el) { el.classList.add("in"); });
      }
    }
  });
})();
