/**
 * theme-init.js — 首屏主题引导（同步执行，必须在样式生效前跑完）
 *
 * 单独成文件而不是内联脚本，是为了让页面可以使用严格的 CSP（script-src 'self'）。
 */
(function () {
  try {
    var stored = localStorage.getItem('pw-theme');
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = mode === 'dark' ||
      (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.themeMode = mode;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themeMode = 'system';
  }
})();
