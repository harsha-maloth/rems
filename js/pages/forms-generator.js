/* Form generator (admin): create registration forms and manage the existing ones.
 * A form is one row in public.forms; answers are rows in public.form_responses (see register.js).
 */
(async function () {
  'use strict';
  document.title = 'Form Generator: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'form.manage' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var PRESETS = [
    { value: 'name',     label: 'Full Name',           icon: 'fas fa-user',          on: true },
    { value: 'regno',    label: 'Registration Number', icon: 'fas fa-id-card' },
    { value: 'dept',     label: 'Department',          icon: 'fas fa-building' },
    { value: 'year',     label: 'Year of Study',       icon: 'fas fa-calendar' },
    { value: 'email',    label: 'Email Address',       icon: 'fas fa-envelope',      on: true },
    { value: 'phoneno',  label: 'Phone Number',        icon: 'fas fa-phone' },
    { value: 'college',  label: 'College Name',        icon: 'fas fa-university' },
    { value: 'github',   label: 'GitHub Username',     icon: 'fab fa-github' },
    { value: 'linkedin', label: 'LinkedIn Profile',    icon: 'fab fa-linkedin' }
  ];
  var MAX_FIELDS = 30;

  function flash(kind, html) {
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }

  // Same rule the dashboard counter uses to match a form to the latest event.
  function slugify(name) {
    return String(name).toLowerCase().replace(/[^0-9a-z_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }
  // Custom field labels become JSON keys: lowercase letters/digits/underscore, starting with a letter
  // (so the participant number added for team forms can never be confused with part of the label).
  function normLabel(s) {
    return String(s).trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^[^a-z]+/, '').replace(/_+$/g, '').slice(0, 40);
  }
  function formUrl(slug) {
    return new URL('register.html?form=' + encodeURIComponent(slug), location.href).href;
  }

  // ---- build the static parts of the create form ----
  $('preset-fields').innerHTML = PRESETS.map(function (p, i) {
    return '<div class="col-12 col-md-6"><div class="form-check mb-1">' +
      '<input class="form-check-input preset" type="checkbox" id="pf-' + i + '" value="' + p.value + '"' + (p.on ? ' checked' : '') + '>' +
      '<label class="form-check-label font-weight-bold" for="pf-' + i + '"><i class="' + p.icon + ' mr-1"></i> ' + esc(p.label) + '</label></div></div>';
  }).join('');
  $('team-size').innerHTML = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');

  var isTeam = function () { return $('type-team').checked; };
  function syncType() { $('team-size-wrap').style.display = isTeam() ? '' : 'none'; }
  $('type-ind').addEventListener('change', syncType);
  $('type-team').addEventListener('change', syncType);

  $('event-name').addEventListener('input', function () {
    var s = slugify(this.value);
    $('slug-hint').textContent = s ? 'Share link: ' + formUrl(s) : 'The share link is created from the name.';
  });

  // ---- create ----
  $('gen-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('msg').innerHTML = '';
    var name = $('event-name').value.trim().replace(/\s+/g, ' ');
    var slug = slugify(name);
    if (!name || !slug) { flash('danger', 'Please enter an event name that contains letters or numbers.'); return; }

    var fields = [];
    document.querySelectorAll('.preset:checked').forEach(function (c) { fields.push(c.value); });
    $('custom-fields').value.split(',').forEach(function (raw) {
      if (!raw.trim()) return;
      var l = normLabel(raw);
      if (!l) { fields.push(null); return; }          // marks an unusable label
      if (fields.indexOf(l) === -1) fields.push(l);
    });
    if (fields.indexOf(null) > -1) { flash('danger', 'A custom field needs a label that starts with a letter (letters, numbers and _ only).'); return; }
    if (!fields.length) { flash('danger', 'Pick at least one field.'); return; }
    if (fields.length > MAX_FIELDS) { flash('danger', 'Please use at most ' + MAX_FIELDS + ' fields.'); return; }

    var team = isTeam();
    var row = {
      club_id: REMS.clubId(),
      slug: slug,
      name: name,
      description: $('event-desc').value.trim(),
      event_type: team ? 'team' : 'individual',
      number_participants: team ? parseInt($('team-size').value, 10) : 1,
      fields: fields
    };

    var btn = $('gen-btn'), label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Generating...';
    try {
      var r = await sb.from('forms').insert(row).select('slug').single();
      if (r.error) {
        if (r.error.code === '23505') { flash('danger', 'A form with the link <code>' + esc(slug) + '</code> already exists. Use a different event name.'); return; }
        throw r.error;
      }
      await REMS.log('Generated form ' + slug);
      var url = formUrl(slug);
      flash('success', 'Form created. Share this link: <a class="alert-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>');
      $('gen-form').reset(); syncType(); $('slug-hint').textContent = 'The share link is created from the name.';
      await loadForms();
    } catch (err) {
      console.error(err);
      flash('danger', 'Could not create the form: ' + esc(err.message || 'unknown error'));
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });

  // ---- existing forms ----
  var forms = [];
  async function loadForms() {
    var r = await sb.from('forms')
      .select('id,slug,name,event_type,number_participants,fields,form_responses(count)')
      .eq('club_id', REMS.clubId())
      .order('id', { ascending: false });
    if (r.error) {
      $('forms-body').innerHTML = '<tr><td colspan="6" class="text-danger">Could not load forms: ' + esc(r.error.message) + '</td></tr>';
      return;
    }
    forms = r.data;
    if (!forms.length) {
      $('forms-body').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No forms yet. Create one above.</td></tr>';
      return;
    }
    $('forms-body').innerHTML = forms.map(function (f, i) {
      var count = f.form_responses && f.form_responses[0] ? f.form_responses[0].count : 0;
      var type = f.event_type === 'team' ? 'Team of ' + f.number_participants : 'Individual';
      var chips = (Array.isArray(f.fields) ? f.fields : []).map(function (x) { return '<span class="badge badge-light border mr-1">' + esc(x) + '</span>'; }).join('');
      return '<tr><td class="font-weight-bold">' + esc(f.name) + '</td><td class="text-nowrap">' + esc(type) + '</td><td>' + chips + '</td>' +
        '<td class="text-center"><a href="forms-registrations.html?form=' + encodeURIComponent(f.slug) + '">' + count + '</a></td>' +
        '<td><div class="input-group input-group-sm"><input type="text" class="form-control" readonly id="link-' + i + '" value="' + esc(formUrl(f.slug)) + '">' +
        '<div class="input-group-append"><button class="btn btn-outline-secondary" type="button" data-act="copy" data-i="' + i + '" aria-label="Copy link"><i class="far fa-copy"></i></button></div></div></td>' +
        '<td class="text-nowrap text-right">' +
        '<a class="btn btn-info btn-sm mr-1" href="forms-registrations.html?form=' + encodeURIComponent(f.slug) + '" aria-label="View registrations"><i class="fas fa-eye"></i></a>' +
        '<button class="btn btn-danger btn-sm" type="button" data-act="del" data-i="' + i + '" aria-label="Delete form"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  }

  $('forms-body').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var f = forms[parseInt(b.dataset.i, 10)];
    if (b.dataset.act === 'copy') {
      var input = $('link-' + b.dataset.i), text = input.value;
      try { await navigator.clipboard.writeText(text); }
      catch (err) { input.select(); input.setSelectionRange(0, 99999); document.execCommand('copy'); }
      b.innerHTML = '<i class="fas fa-check text-success"></i>';
      setTimeout(function () { b.innerHTML = '<i class="far fa-copy"></i>'; }, 1500);
      return;
    }
    var count = f.form_responses && f.form_responses[0] ? f.form_responses[0].count : 0;
    if (!window.confirm('Delete "' + f.name + '"' + (count ? ' and its ' + count + ' registration' + (count === 1 ? '' : 's') : '') +
      '?\nThe share link will stop working. This cannot be undone.' + (count ? '\n\nTip: download the CSV first.' : ''))) return;
    b.disabled = true;
    var r = await sb.from('forms').delete().eq('id', f.id).select('id');
    if (r.error) { flash('danger', 'Delete failed: ' + esc(r.error.message)); b.disabled = false; return; }
    if (!r.data.length) { flash('warning', 'Nothing was deleted (the form may already be gone).'); b.disabled = false; return; }
    await REMS.log('Deleted form ' + f.slug + ' (' + count + ' registrations)');
    flash('success', 'Form "' + esc(f.name) + '" deleted.');
    await loadForms();
  });

  syncType();
  await loadForms();
})();
