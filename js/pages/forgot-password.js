(function () {
  document.title = 'Forgotten Password - ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var msg = document.getElementById('msg');
  var form = document.getElementById('forgot-form');
  var btn = document.getElementById('forgot-btn');

  if (!REMS.configured()) { REMS.showConfigError(); return; }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = String(new FormData(form).get('email') || '').trim();
    if (!email) { msg.innerHTML = '<div class="alert alert-danger" role="alert">Email required</div>'; return; }
    btn.disabled = true;
    try {
      var redirectTo = new URL('change-password.html', location.href).href;
      var res = await REMS.sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
      if (res.error) {
        msg.innerHTML = '<div class="alert alert-danger" role="alert">' + REMS.esc(res.error.message) + '</div>';
      } else {
        // Same message whether or not the account exists, so emails cannot be probed.
        msg.innerHTML = '<div class="alert alert-success" role="alert">If that account exists, your e-mail has been sent!</div>';
      }
    } catch (err) {
      console.error(err);
      msg.innerHTML = '<div class="alert alert-danger" role="alert">Something went wrong. Please try again.</div>';
    } finally {
      btn.disabled = false;
    }
  });
})();
