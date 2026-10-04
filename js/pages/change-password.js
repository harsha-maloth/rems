(function () {
  document.title = 'Change Password - ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var states = ['wait', 'expired', 'form', 'done'];
  function setState(name) {
    states.forEach(function (s) {
      document.getElementById('state-' + s).style.display = s === name ? '' : 'none';
    });
  }
  if (!REMS.configured()) { REMS.showConfigError(); return; }

  var sb = REMS.sb;
  var settled = false;
  function ready() { if (!settled) { settled = true; setState('form'); } }

  if (/error(_code)?=/.test(location.hash)) { settled = true; setState('expired'); return; }

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') ready();
  });
  setTimeout(async function () {
    if (settled) return;
    var r = await sb.auth.getSession();
    if (r.data.session) ready(); else { settled = true; setState('expired'); }
  }, 2500);

  var form = document.getElementById('change-form');
  var msg = document.getElementById('msg');
  var btn = document.getElementById('change-btn');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = new FormData(form);
    var pwd = String(d.get('pwd') || '');
    if (pwd !== String(d.get('pwd_confirm') || '')) {
      msg.innerHTML = '<div class="alert alert-danger">Passwords do not match</div>';
      return;
    }
    btn.disabled = true;
    try {
      var res = await sb.auth.updateUser({ password: pwd });
      if (res.error) {
        msg.innerHTML = '<div class="alert alert-danger">' + REMS.esc(res.error.message) + '</div>';
        return;
      }
      await sb.auth.signOut();
      setState('done');
    } catch (err) {
      console.error(err);
      msg.innerHTML = '<div class="alert alert-danger">Database error</div>';
    } finally {
      btn.disabled = false;
    }
  });
})();
