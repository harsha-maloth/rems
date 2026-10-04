(function () {
  'use strict';
  var cfg = REMS.cfg, esc = REMS.esc;
  document.title = 'Claim your account: ' + (cfg.APP_NAME || cfg.ORG_NAME);
  document.getElementById('org-tagline').textContent = cfg.ORG_TAGLINE;
  var msg = document.getElementById('msg');
  var form = document.getElementById('signup-form');
  var btn = document.getElementById('signup-btn');
  var domain = '';

  function show(kind, html) { msg.innerHTML = '<div class="alert alert-' + kind + '">' + html + '</div>'; }

  if (!REMS.configured()) { REMS.showConfigError(); return; }

  REMS.sb.rpc('institute_domain').then(function (r) {
    if (r.error || !r.data) return;
    domain = String(r.data).toLowerCase();
    document.getElementById('domain-hint').textContent = 'Must end with @' + domain;
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    msg.innerHTML = '';
    var d = new FormData(form);
    var email = String(d.get('email') || '').trim().toLowerCase();
    var pw = String(d.get('password') || ''), pw2 = String(d.get('password2') || '');

    if (domain && email.slice(email.lastIndexOf('@') + 1) !== domain) { show('danger', 'Please use your institute e-mail (ending in <strong>@' + esc(domain) + '</strong>).'); return; }
    if (pw.length < 8) { show('danger', 'The password needs at least 8 characters.'); return; }
    if (pw !== pw2) { show('danger', 'The two passwords are different.'); return; }

    btn.disabled = true;
    try {
      var ok = await REMS.sb.rpc('can_claim', { p_email: email });
      if (ok.error) throw ok.error;
      if (ok.data !== true) {
        show('warning', 'This e-mail is not on the admitted list, or its account is already claimed. If you already signed up, <a href="login.html">log in</a>. Otherwise ask your student affairs office to check the list.');
        return;
      }
      var redirect = location.href.replace(/[^\/]*([?#].*)?$/, '') + 'login.html';
      var res = await REMS.sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: redirect } });
      if (res.error) throw res.error;
      if (res.data && res.data.user && res.data.user.identities && res.data.user.identities.length === 0) {
        show('warning', 'An account with this e-mail already exists. <a href="login.html">Log in</a> or use "Forgot password".');
        return;
      }
      form.style.display = 'none';
      show('success', 'Almost done. We sent a confirmation link to <strong>' + esc(email) + '</strong>. Open it, then <a href="login.html">log in</a> with this e-mail and your password.');
    } catch (err) {
      console.error(err);
      show('danger', 'Could not create the account: ' + esc(err.message || 'unknown error'));
    } finally {
      btn.disabled = false;
    }
  });
})();
