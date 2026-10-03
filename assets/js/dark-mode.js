// Dark mode toggle. Load this in <head> so the theme applies before first paint.
// Keeps the original change_mode(theme) API; the preference now persists in localStorage.
(function () {
  var script = document.currentScript;
  var base = script ? script.src.replace(/js\/dark-mode\.js.*$/, '') : 'assets/';
  var cssHref = base + 'css/dark-mode.css';

  function stored() {
    try { return localStorage.getItem('rems.theme') === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  window.change_mode = function (theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem('rems.theme', theme); } catch (e) {}
    var link = document.getElementById('dark-mode-css');
    if (theme === 'dark' && !link) {
      link = document.createElement('link');
      link.id = 'dark-mode-css';
      link.rel = 'stylesheet';
      link.href = cssHref;
      document.head.appendChild(link);
    } else if (theme === 'light' && link) {
      link.remove();
    }
    var toggle = document.getElementById('toggle-switch');
    if (toggle) toggle.checked = theme === 'dark';
  };

  change_mode(stored());

  // Toggle lives in the injected top bar, so listen at the document level.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'toggle-switch') {
      change_mode(e.target.checked ? 'dark' : 'light');
    }
  });
})();
