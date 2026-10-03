(function () {
  var cfg = REMS.cfg;
  document.title = 'Login: ' + (cfg.APP_NAME || cfg.ORG_NAME);
  document.getElementById('org-tagline').textContent = cfg.ORG_TAGLINE;
  var msg = document.getElementById('msg');
  var form = document.getElementById('login-form');
  var btn = document.getElementById('login-btn');

  function show(text) {
    msg.innerHTML = '<div class="alert alert-danger">' + REMS.esc(text) + '</div>';
  }

  if (!REMS.configured()) { REMS.showConfigError(); return; }

  var params = new URLSearchParams(location.search);
  var next = REMS.safeNext(params.get('next'));

  // Already signed in? Skip the form.
  REMS.sb.auth.getSession().then(function (r) {
    if (r.data.session) location.replace(next);
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    msg.innerHTML = '';
    var data = new FormData(form);
    var uname = String(data.get('uname') || '').trim();
    var password = String(data.get('password') || '');
    REMS.setRemember(!!data.get('remember'));
    btn.disabled = true;

    try {
      var email = uname;
      if (uname.indexOf('@') === -1) {
        var lookup = await REMS.sb.rpc('email_for_username', { uname: uname });
        email = lookup.data;
      }
      if (!email) { show('Invalid credentials'); return; }

      var res = await REMS.sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) {
  console.error('Sign-in error:', res.error.status, res.error.message);
  show(res.error.status === 400 ? 'Invalid credentials' : 'Sign-in error: ' + res.error.message);
  return;
}

      var prof = await REMS.sb.from('profiles').select('login_name').eq('id', res.data.user.id).maybeSingle();
      if (prof.data) {
        REMS.profile = prof.data;
        await REMS.log('Logged in');
      }
      location.replace(next);
    } catch (err) {
      console.error(err);
      show('Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });
})();
