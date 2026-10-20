// Applies the saved colour theme before first paint (kept external to satisfy the CSP).
(function () {
  try {
    var theme = localStorage.getItem('loconvert-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* storage unavailable: follow the OS */
  }
})();
