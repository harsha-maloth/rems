(function () {
  'use strict';
  var esc = REMS.esc;
  var content = document.getElementById('content');
  var titleEl = document.getElementById('form-title');

  var DEPARTMENTS = (REMS.cfg && REMS.cfg.DEPARTMENTS) || [
    'Aerospace Engineering',
    'Avionics',
    'Chemistry',
    'Earth and Space Sciences',
    'Humanities',
    'Mathematics',
    'Physics',
    'Other'
  ];
  var YEARS = [1, 2, 3, 4, 5];

  function fail(text) {
    content.innerHTML = '<div class="alert alert-danger" role="alert"><i class="fas fa-exclamation-triangle mr-2"></i>' + esc(text) + '</div>';
  }
  if (!REMS.configured()) { REMS.showConfigError(); fail('The site is not configured yet.'); return; }

  var slug = (new URLSearchParams(location.search).get('form') || '').trim();
  if (!slug) { location.replace('bad-request.html'); return; }

  function kindOf(label) {
    var n = String(label).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n === 'dept' || n === 'department') return 'dept';
    if (n === 'year') return 'year';
    if (n === 'email' || n === 'emailid' || n === 'mail') return 'email';
    if (n === 'phoneno' || n === 'phone' || n === 'phonenumber' || n === 'mobile' || n === 'mobileno' || n === 'contactno') return 'tel';
    if (n === 'github' || n === 'linkedin') return 'url';
    return 'text';
  }

  function labelText(label) { return String(label).replace(/_/g, ' '); }

  function inputHtml(label, key, id) {
    var common = ' class="form-control" id="' + id + '" data-key="' + esc(key) + '" required';
    var kind = kindOf(label);
    if (kind === 'dept' || kind === 'year') {
      var opts = (kind === 'dept' ? DEPARTMENTS : YEARS).map(function (o) {
        return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
      }).join('');
      return '<select' + common + '><option value="" selected disabled>Select&hellip;</option>' + opts + '</select>';
    }
    if (kind === 'email') return '<input' + common + ' type="email" maxlength="255" autocomplete="email">';
    if (kind === 'tel') return '<input' + common + ' type="tel" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" title="Enter a 10 digit number" autocomplete="tel">';
    if (kind === 'url') return '<input' + common + ' type="url" maxlength="255" placeholder="https://">';
    return '<input' + common + ' type="text" maxlength="255">';
  }

  function render(f) {
    var fields = Array.isArray(f.fields) ? f.fields.filter(function (x) { return typeof x === 'string' && x.trim(); }) : [];
    if (!fields.length) { fail('This form has no fields yet. Please check back later.'); return; }

    var team = f.event_type === 'team';
    var n = team ? Math.max(1, f.number_participants || 1) : 1;
    var html = '';
    if (f.description) html += '<p class="mb-4" style="white-space:pre-line">' + esc(f.description) + '</p>';
    html += '<form id="reg-form" novalidate>';
    var counter = 0;
    for (var p = 1; p <= n; p++) {
      if (team) html += '<h5 class="mt-3 mb-2 text-primary">Participant ' + p + '</h5>';
      fields.forEach(function (label) {
        var key = team ? label + p : label;
        var id = 'f' + (counter++);
        html += '<div class="mb-3"><label class="form-label text-capitalize" for="' + id + '">' + esc(labelText(label)) + '</label>' +
          inputHtml(label, key, id) + '</div>';
      });
    }

    html += '<div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true">' +
      '<label>Leave this empty<input type="text" id="hp" tabindex="-1" autocomplete="off"></label></div>';
    html += '<div id="msg" aria-live="polite"></div><button class="btn btn-primary" type="submit" id="submit-btn">Submit</button></form>';
    content.innerHTML = html;

    var form = document.getElementById('reg-form');
    var msg = document.getElementById('msg');
    var btn = document.getElementById('submit-btn');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.innerHTML = '';
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (document.getElementById('hp').value) { location.replace('congrats.html'); return; }

      var data = {};
      form.querySelectorAll('[data-key]').forEach(function (el) { data[el.getAttribute('data-key')] = el.value.trim(); });

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
      try {
        var r = await REMS.sb.from('form_responses').insert({ form_id: f.id, data: data });
        if (r.error) throw r.error;
        location.replace('congrats.html');
      } catch (err) {
        console.error(err);
        msg.innerHTML = '<div class="alert alert-danger" role="alert">Could not submit your registration. Please check your connection and try again.</div>';
        btn.disabled = false;
        btn.textContent = 'Submit';
      }
    });
  }

  REMS.sb.from('forms')
    .select('id,slug,name,description,event_type,number_participants,fields')
    .eq('slug', slug)
    .maybeSingle()
    .then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) { location.replace('bad-request.html'); return; }
      titleEl.textContent = r.data.name;
      document.title = 'Register: ' + r.data.name;
      render(r.data);
    })
    .catch(function (err) {
      console.error(err);
      titleEl.textContent = 'Something went wrong';
      fail('Could not load this form. Please refresh the page or try again in a moment.');
    });
})();
