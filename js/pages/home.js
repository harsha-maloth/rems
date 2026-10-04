(function () {
  'use strict';
  var cfg = REMS.cfg || {};
  var tag = document.getElementById('org-tagline');
  if (tag && cfg.ORG_TAGLINE) tag.textContent = cfg.ORG_TAGLINE;

  var msg = document.getElementById('msg');
  var form = document.getElementById('event-form');
  var input = document.getElementById('event-input');
  var btn = document.getElementById('search-btn');
  var BTN_LABEL = btn.innerHTML;

  function show(text) {
    msg.innerHTML = '<div class="alert alert-danger" role="alert"><i class="fas fa-exclamation-triangle mr-2"></i><strong>' +
      REMS.esc(text) + '</strong></div>';
    input.focus();
  }

  function escLike(s) { return s.replace(/[\\%_]/g, function (c) { return '\\' + c; }); }

  var params = new URLSearchParams(location.search);
  if (params.get('status') === 'notfound') {
    var searched = (params.get('searched_event') || '').trim().slice(0, 200);
    show(searched
      ? "Event '" + searched + "' not found. Are you sure you're spelling it right?"
      : 'Event not found. Please enter a valid event name.');
  }

  if (!REMS.configured()) { REMS.showConfigError(); return; }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    msg.innerHTML = '';
    var name = input.value.trim();
    if (!name) { show('Please enter an event name to search.'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Searching...';
    try {
      var r = await REMS.sb.from('events').select('event_name').ilike('event_name', escLike(name)).limit(1);
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) {
        show("Event '" + name + "' not found. Are you sure you're spelling it right?");
        return;
      }
      location.href = 'cds-public.html?event=' + encodeURIComponent(r.data[0].event_name);
    } catch (err) {
      console.error(err);
      show('Could not reach the server. Please try again in a moment.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = BTN_LABEL;
    }
  });
})();
