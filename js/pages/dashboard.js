(async function () {
  document.title = 'Dashboard: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var profile;
  try { profile = await REMS.requireAuth(); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  // Greeting by first name (plain text, never HTML)
  var first = String(profile.full_name || profile.login_name || '').trim().split(/\s+/)[0];
  if (first) document.getElementById('welcome-title').textContent = 'Welcome, ' + first;

  if (REMS.can('announcement.post')) document.getElementById('alert-type-group').style.display = '';

  var form = document.getElementById('alert-form');
  var msg = document.getElementById('msg');
  if (!REMS.club) {
    // A student who is not in any club yet lands in the student portal.
    var own = await REMS.sb.from('students').select('id').eq('profile_id', profile.id).maybeSingle();
    if (own.data) { location.replace('student.html'); return; }
    // Signed in, but no club has added this account yet (or migration 0005 is missing).
    msg.innerHTML = '<div class="alert alert-info">You are not part of any club yet. Ask a club president to add you, or a platform admin to create your club.</div>';
    Array.prototype.forEach.call(form.elements, function (el) { el.disabled = true; });
    return;
  }

  var stats = await REMS.sb.rpc('dashboard_stats', { p_club: REMS.clubId() });
  var eventsHeld = null;
  if (!stats.error && stats.data) {
    var d = stats.data;
    document.getElementById('stat-registrations').textContent = d.registration_count;
    document.getElementById('stat-members').textContent = d.members_count;
    document.getElementById('stat-events').textContent = d.events_count;
    document.getElementById('latest-event-line').textContent = d.latest_event ? d.latest_event : 'No events yet';
    eventsHeld = Number(d.events_count);
  }
  renderNextSteps(eventsHeld === 0);

  /** Cards for what this person may actually do in the selected club (same checks the menu uses). */
  function renderNextSteps(noEventsYet) {
    var all = [
      { show: REMS.holder(), href: 'club.html', icon: 'fa-sitemap', title: 'Add members and give positions', text: 'Build your team and hand out roles.' },
      { show: REMS.can('form.manage'), href: 'forms-generator.html', icon: 'fa-wpforms fab', title: 'Create a sign-up form', text: 'Collect names for an event and share the link.', start: noEventsYet },
      { show: REMS.can('form.manage'), href: 'forms-registrations.html', icon: 'fa-eye', title: 'See who signed up', text: 'Browse answers and download them as a file.' },
      { show: REMS.can('certificate.issue'), href: 'cert-generate.html', icon: 'fa-medal', title: 'Issue certificates', text: 'Upload a list and make a certificate for everyone.' },
      { show: REMS.can('mail.send'), href: 'mailing-bulk.html', icon: 'fa-mail-bulk', title: 'Send an email', text: 'Write one message to a whole contact list.' },
      { show: REMS.can('link.manage'), href: 'link-short.html', icon: 'fa-link', title: 'Make a short link', text: 'Turn a long web address into a short one.' },
      { show: true, href: 'student.html', icon: 'fa-user-graduate', title: 'Open my student portal', text: 'Your record, clubs and certificates.' }
    ].filter(function (c) { return c.show; });
    if (!all.length) return;
    document.getElementById('next-steps').innerHTML = all.map(function (c) {
      return '<div class="col-md-6 col-xl-4 mb-4"><a class="card shadow orbit-next-card" href="' + c.href + '">' +
        '<div class="card-body"><div class="d-flex align-items-start">' +
        '<i class="fas ' + c.icon + ' fa-lg text-primary mr-3 mt-1" aria-hidden="true"></i>' +
        '<div><div class="font-weight-bold text-dark">' + c.title +
        (c.start ? ' <span class="badge badge-primary ml-1">Start here</span>' : '') + '</div>' +
        '<div class="small text-muted">' + c.text + '</div></div></div></div></a></div>';
    }).join('');
    document.getElementById('next-wrap').hidden = false;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = new FormData(form);
    var message = String(f.get('alertMessage') || '').trim();
    if (!message) return;
    var type = REMS.can('announcement.post') ? String(f.get('type') || 'info') : 'info';
    var res = await REMS.sb.from('notification').insert({
      club_id: REMS.clubId(), username: profile.login_name, message: message, type: type, click_url: '#'
    });
    if (res.error) {
      msg.innerHTML = '<div class="alert alert-danger">Could not post the announcement. Please try again.</div>';
      return;
    }
    await REMS.log('Pushed dashboard alert');
    location.reload();
  });
})();
