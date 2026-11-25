// Runs before first paint. Keep theme resolution in sync with src/design/theme.ts.
(function () {
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('loconvert-theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
    if (stored === 'system' && window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'light';
    }
  } catch {
    // Storage can be unavailable. The default still applies.
  }

  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]').content = theme;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor.content = themeColor.dataset[theme];
  if (theme === 'light') {
    var favicon = document.querySelector('link[rel="icon"]');
    favicon.href += '#light';
  }
})();
