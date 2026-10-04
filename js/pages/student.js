(async function () {
  'use strict';
  document.title = 'Student Portal: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var profile;
  try { profile = await REMS.requireAuth(); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  function flash(kind, html) { $('msg').innerHTML = '<div class="alert alert-' + kind + '" role="alert">' + html + '</div>'; }
  function fmtDate(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? esc(v) : d.toLocaleDateString(); }
  function tick(done, text) {
    return '<li class="mb-2"><i class="fas ' + (done ? 'fa-check-circle text-success' : 'fa-circle text-gray-400') + ' mr-2"></i>' + text + '</li>';
  }

  var st = await sb.from('students').select('*').eq('profile_id', profile.id).maybeSingle();
  var stu = st.data;
  var row = function (k, v) { return '<tr><th class="text-nowrap pr-3">' + k + '</th><td>' + (v ? esc(v) : '<span class="text-muted">-</span>') + '</td></tr>'; };
  if (stu) {
    $('record').innerHTML = '<table class="table table-sm table-borderless mb-0"><tbody>' +
      row('Name', stu.full_name) + row('Institute e-mail', stu.institute_email) + row('Enrolment no.', stu.enrolment_no) +
      row('Department', stu.department) + row('Programme', stu.programme) + row('Batch', stu.batch) + row('Status', stu.status) +
      '</tbody></table><p class="small text-muted mt-2 mb-0">This comes from the institute\'s list. If something is wrong, ask your student affairs office.</p>';
  } else {
    $('record').innerHTML = '<p class="mb-0">There is no student record for this account. This portal is for admitted students; club staff can use the menu on the left.</p>';
  }

  var phoneSaved = !!(profile.phno && String(profile.phno).trim() && profile.first_name && String(profile.first_name).trim());
  var completed = !!(stu && stu.profile_completed_at);
  function drawChecklist() {
    $('checklist').innerHTML =
      tick(!!stu, 'Account claimed with your institute e-mail') +
      tick(phoneSaved, 'Name and phone number saved in <a href="profile.html">your profile</a>') +
      tick(completed, 'Profile marked complete') +
      tick(REMS.clubs.length > 0, 'Member of a club');
    $('complete-btn').style.display = (stu && !completed && phoneSaved) ? '' : 'none';
  }
  drawChecklist();
  $('complete-btn').addEventListener('click', async function () {
    this.disabled = true;
    var r = await sb.rpc('complete_my_profile');
    if (r.error || r.data !== true) { flash('warning', 'Save your name and phone number in your profile first.'); this.disabled = false; return; }
    completed = true; if (stu) stu.profile_completed_at = new Date().toISOString();
    await REMS.log('Marked student profile complete');
    drawChecklist();
    flash('success', 'Thank you, your profile is marked complete.');
  });

  $('my-clubs').innerHTML = REMS.clubs.length
    ? '<ul class="list-unstyled mb-0">' + REMS.clubs.map(function (c) {
        return '<li class="mb-2"><strong>' + esc(c.name) + '</strong> ' +
          (c.titles.length ? c.titles.map(function (t) { return '<span class="badge badge-primary mr-1">' + esc(t) + '</span>'; }).join('') : '<span class="badge badge-secondary">Member</span>') + '</li>';
      }).join('') + '</ul>'
    : '<p class="text-muted mb-0">You are not in a club yet. Browse the directory below. Applying to clubs arrives in a later release; for now ask a club president to add you.</p>';

  var dir = await sb.rpc('club_directory');
  if (dir.error) { $('directory-body').innerHTML = '<tr><td colspan="4" class="text-danger">Could not load clubs: ' + esc(dir.error.message) + '</td></tr>'; }
  else if (!dir.data.length) { $('directory-body').innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">No clubs yet.</td></tr>'; }
  else {
    $('directory-body').innerHTML = dir.data.map(function (c) {
      return '<tr><td class="font-weight-bold">' + esc(c.name) + '</td><td>' + esc(c.description) + '</td><td>' + esc(c.faculty_advisor || '') +
        '</td><td>' + (c.is_member ? '<span class="badge badge-success">Member</span>' : '') + '</td></tr>';
    }).join('');
  }

  var certs = await sb.rpc('my_certificates');
  if (certs.error) { $('certs-body').innerHTML = '<tr><td colspan="5" class="text-danger">Could not load certificates: ' + esc(certs.error.message) + '</td></tr>'; }
  else if (!certs.data.length) { $('certs-body').innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">No certificates have been issued to your e-mail yet.</td></tr>'; }
  else {
    $('certs-body').innerHTML = certs.data.map(function (c) {
      var link = /^https?:\/\//i.test(c.cert_link || '') ? '<a href="' + esc(c.cert_link) + '" target="_blank" rel="noopener">Open</a>' : '';
      return '<tr><td class="font-weight-bold">' + esc(c.event_name) + '</td><td>' + esc(c.club_name || '') + '</td><td>' + esc(c.position || '') +
        '</td><td class="text-nowrap">' + fmtDate(c.event_date) + '</td><td>' + link + '</td></tr>';
    }).join('');
  }
})();
