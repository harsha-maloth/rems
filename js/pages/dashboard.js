(async function () {
  document.title = 'Dashboard: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var profile;
  try { profile = await REMS.requireAuth(); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

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
  if (!stats.error && stats.data) {
    document.getElementById('latest-event').textContent = stats.data.latest_event;
    document.getElementById('stat-registrations').textContent = stats.data.registration_count;
    document.getElementById('stat-members').textContent = stats.data.members_count;
    document.getElementById('stat-events').textContent = stats.data.events_count;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = new FormData(form);
    var message = String(d.get('alertMessage') || '').trim();
    if (!message) return;
    var type = REMS.can('announcement.post') ? String(d.get('type') || 'info') : 'info';
    var res = await REMS.sb.from('notification').insert({
      club_id: REMS.clubId(), username: profile.login_name, message: message, type: type, click_url: '#'
    });
    if (res.error) {
      msg.innerHTML = '<div class="alert alert-danger">Failed to push alert</div>';
      return;
    }
    await REMS.log('Pushed dashboard alert');
    location.reload();
  });
})();
