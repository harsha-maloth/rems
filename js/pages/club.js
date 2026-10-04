(async function () {
  'use strict';
  document.title = 'Members & positions: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ holder: true }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var club = REMS.club, cid = club.id;
  var members = [], positions = [], teams = [], catalogue = [], editing = null;

  $('club-name').textContent = club.name;

  function lockNote(el, text) {
    var n = document.createElement('p');
    n.className = 'text-muted small';
    n.innerHTML = '<i class="fas fa-lock mr-1"></i>';
    n.appendChild(document.createTextNode(text));
    el.parentNode.insertBefore(n, el);
  }
  if (!REMS.can('position.assign')) {
    $('pe-card').style.display = 'none';
    lockNote($('pe-card'), 'Creating and editing positions needs a position that allows it, such as the President.');
  }
  if (!REMS.can('team.manage')) {
    $('t-add').style.display = 'none';
    lockNote($('t-add'), 'Adding teams needs a position that allows it, such as the President.');
  }

  function flash(kind, html) {
    if (REMS.toastIfShort(kind, html)) { $('msg').innerHTML = ''; return; }
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }
  function fail(err) { flash('danger', esc((err && err.message) || err || 'Something went wrong.')); }

  async function call(name, args) {
    var r = await sb.rpc(name, args);
    if (r.error) throw r.error;
    return r.data;
  }
  function teamOptions(selected, withNone) {
    return (withNone ? '<option value="">' + esc(withNone) + '</option>' : '') + teams.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (String(t.id) === String(selected) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
  }

  async function load() {
    var results = await Promise.all([
      sb.rpc('club_members', { p_club: cid }),
      sb.rpc('club_positions', { p_club: cid }),
      sb.from('teams').select('id,name').eq('club_id', cid).order('name'),
      sb.from('permissions').select('key,description').order('key')
    ]);

    members = results[0].error ? [] : (results[0].data || []);
    positions = results[1].error ? [] : (results[1].data || []);
    teams = results[2].error ? [] : (results[2].data || []);
    catalogue = results[3].error ? [] : (results[3].data || []);
    var firstError = results.map(function (r) { return r.error; }).filter(Boolean)[0];
    if (firstError) flash('warning', 'Some data could not be loaded: ' + esc(firstError.message) +
      ' (is migration 0007 applied?)');
    render();
  }

  function render() { renderMembers(); renderPositions(); renderAppointForm(); renderPermBoxes(); renderTeams(); }

  function renderMembers() {
    var q = $('m-filter').value.trim().toLowerCase();
    var rows = members.filter(function (m) {
      return !q || [m.full_name, m.login_name, m.email, m.team_name].join(' ').toLowerCase().indexOf(q) > -1;
    });
    $('m-body').innerHTML = rows.length ? rows.map(function (m) {
      var badge = m.status === 'active' ? 'success' : (m.status === 'pending' ? 'warning' : 'secondary');
      var rm = (REMS.can('member.remove') && m.status === 'active' && m.profile_id !== REMS.profile.id)
        ? '<button class="btn btn-sm btn-outline-danger" data-remove="' + esc(m.profile_id) + '" data-name="' + esc(m.full_name || m.login_name) + '">Remove</button>' : '';
      return '<tr><td>' + esc(m.full_name || m.login_name) + '<br><small class="text-muted">' + esc(m.email) + '</small></td>' +
        '<td>' + esc(m.team_name || '') + '</td><td>' + esc((m.titles || []).join(', ')) + '</td>' +
        '<td><span class="badge badge-' + badge + '">' + esc(m.status) + '</span></td><td class="text-right">' + rm + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-muted">No members to show.</td></tr>';
    $('m-info').textContent = rows.length + ' of ' + members.length + ' shown.' +
      (REMS.can('member.view') ? '' : ' You see your own team only.');
    $('m-team').innerHTML = teamOptions('', 'No team yet');
  }

  function renderPositions() {
    var canEdit = REMS.can('position.assign');
    $('p-body').innerHTML = positions.length ? positions.map(function (p) {
      var holders = (p.holders || []).map(function (h) {
        return '<span class="badge badge-light border mr-1 mb-1">' + esc(h.name) + (h.team_name ? ' (' + esc(h.team_name) + ')' : '') +
          ' <a href="#" class="text-danger" data-end="' + esc(h.term_id) + '" data-name="' + esc(h.name) + '" title="End this term">&times;</a></span>';
      }).join('') || '<span class="text-muted">vacant</span>';
      var tools = (canEdit && p.level > 1)
        ? '<button class="btn btn-sm btn-outline-primary mr-1" data-edit="' + esc(p.position_id) + '">Edit</button>' +
          '<button class="btn btn-sm btn-outline-danger" data-del="' + esc(p.position_id) + '" data-name="' + esc(p.title) + '">Delete</button>' : '';
      return '<tr><td>' + esc(p.level) + '</td><td>' + esc(p.title) +
        (p.scope === 'team' ? ' <span class="badge badge-info">team</span>' : '') + '</td><td>' + holders + '</td><td class="text-right">' + tools + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="text-muted">No positions yet. Use "Add standard positions" below.</td></tr>';
  }

  function renderAppointForm() {
    var cur = $('a-pos').value;
    $('a-pos').innerHTML = positions.map(function (p) {
      return '<option value="' + esc(p.position_id) + '" data-scope="' + esc(p.scope) + '">' + esc(p.title) + ' (level ' + esc(p.level) + ')</option>';
    }).join('');
    if (cur) $('a-pos').value = cur;
    $('a-team').innerHTML = teamOptions('', 'Not needed');
    syncTeamField();
  }
  function selectedPosition() {
    return positions.filter(function (p) { return String(p.position_id) === $('a-pos').value; })[0];
  }
  function syncTeamField() {
    var p = selectedPosition();
    var needs = !!p && p.scope === 'team';
    $('a-team').disabled = !needs;
    if (!needs) $('a-team').value = '';
  }

  function renderPermBoxes() {
    var checked = {};
    Array.prototype.forEach.call($('pe-perms').querySelectorAll('input:checked'), function (i) { checked[i.value] = true; });
    $('pe-perms').innerHTML = catalogue.map(function (c) {
      var mine = REMS.can(c.key);
      return '<div class="custom-control custom-checkbox custom-control-inline">' +
        '<input type="checkbox" class="custom-control-input" id="pk-' + esc(c.key) + '" value="' + esc(c.key) + '"' +
        (checked[c.key] ? ' checked' : '') + (mine ? '' : ' disabled') + '>' +
        '<label class="custom-control-label" for="pk-' + esc(c.key) + '" title="' + esc(c.description) + '">' + esc(c.key) + '</label></div>';
    }).join('');
  }

  function renderTeams() {
    var count = {};
    members.forEach(function (m) { if (m.team_id && m.status === 'active') count[m.team_id] = (count[m.team_id] || 0) + 1; });
    $('t-list').innerHTML = teams.length ? teams.map(function (t) {
      var del = REMS.can('team.manage')
        ? '<button class="btn btn-sm btn-outline-danger" data-delteam="' + esc(t.id) + '" data-name="' + esc(t.name) + '">Delete</button>' : '';
      return '<li class="list-group-item d-flex justify-content-between align-items-center">' + esc(t.name) +
        '<span><span class="badge badge-primary badge-pill mr-2">' + (count[t.id] || 0) + ' members</span>' + del + '</span></li>';
    }).join('') : '<li class="list-group-item text-muted">No teams yet.</li>';
  }

  $('m-filter').addEventListener('input', renderMembers);
  $('a-pos').addEventListener('change', syncTeamField);

  $('m-add').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('m-email').value.trim();
    if (!email) return;
    try {
      await call('add_member', { p_club: cid, p_email: email, p_team: $('m-team').value ? Number($('m-team').value) : null });
      $('m-email').value = '';
      flash('success', esc(email) + ' is now a member.');
      await load();
    } catch (err) { fail(err); }
  });

  $('m-body').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-remove]');
    if (!b) return;
    if (!await REMS.confirm('Remove ' + b.getAttribute('data-name') + ' from the club? Their positions end too.', { title: 'Remove member', ok: 'Remove', danger: true })) return;
    try { await call('remove_member', { p_club: cid, p_profile: b.getAttribute('data-remove') }); flash('success', 'Member removed.'); await load(); }
    catch (err) { fail(err); }
  });

  function appointArgs() {
    var p = selectedPosition();
    if (!p) throw new Error('Choose a position.');
    var email = $('a-email').value.trim();
    if (!email) throw new Error('Enter the person\'s e-mail.');
    var team = $('a-team').value ? Number($('a-team').value) : null;
    if (p.scope === 'team' && !team) throw new Error('Choose a team for this position.');
    return { p: p, email: email, team: team };
  }
  $('a-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var a = appointArgs();
      await call('appoint', { p_club: cid, p_email: a.email, p_position: a.p.position_id, p_team: a.team });
      $('a-email').value = '';
      flash('success', esc(a.email) + ' now holds ' + esc(a.p.title) + '.');
      await load();
    } catch (err) { fail(err); }
  });
  $('a-handover').addEventListener('click', async function () {
    try {
      var a = appointArgs();
      if (!await REMS.confirm('Hand over ' + a.p.title + ' to ' + a.email + '? The current holder stops holding it immediately.', { title: 'Hand over position', ok: 'Hand over', danger: true })) return;
      await call('handover', { p_club: cid, p_position: a.p.position_id, p_team: a.team, p_new_email: a.email });
      $('a-email').value = '';
      flash('success', 'Handed over ' + esc(a.p.title) + ' to ' + esc(a.email) + '.');
      await REMS.loadClubs();
      if (!REMS.holder()) { location.replace('student.html'); return; }
      await load();
    } catch (err) { fail(err); }
  });

  $('p-body').addEventListener('click', async function (e) {
    var end = e.target.closest('a[data-end]');
    var edit = e.target.closest('button[data-edit]');
    var del = e.target.closest('button[data-del]');
    try {
      if (end) {
        e.preventDefault();
        if (!await REMS.confirm('End the term of ' + end.getAttribute('data-name') + '? It takes effect immediately.', { title: 'End term', ok: 'End term', danger: true })) return;
        await call('end_term', { p_term: Number(end.getAttribute('data-end')) });
        flash('success', 'Term ended.'); await load();
      } else if (edit) {
        var p = positions.filter(function (x) { return String(x.position_id) === edit.getAttribute('data-edit'); })[0];
        editing = p.position_id;
        $('pe-title').textContent = 'Edit position: ' + p.title;
        $('pe-name').value = p.title; $('pe-level').value = p.level; $('pe-scope').value = p.scope;
        Array.prototype.forEach.call($('pe-perms').querySelectorAll('input'), function (i) { i.checked = (p.permissions || []).indexOf(i.value) > -1; });
        $('pe-card').scrollIntoView({ behavior: 'smooth' });
      } else if (del) {
        if (!await REMS.confirm('Delete the position "' + del.getAttribute('data-name') + '"?', { title: 'Delete position', ok: 'Delete', danger: true })) return;
        await call('delete_position', { p_club: cid, p_id: Number(del.getAttribute('data-del')) });
        flash('success', 'Position deleted.'); await load();
      }
    } catch (err) { fail(err); }
  });

  function resetEditor() {
    editing = null; $('pe-title').textContent = 'New position';
    $('pe-form').reset();
    Array.prototype.forEach.call($('pe-perms').querySelectorAll('input'), function (i) { i.checked = false; });
  }
  $('pe-reset').addEventListener('click', resetEditor);
  $('pe-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var perms = Array.prototype.map.call($('pe-perms').querySelectorAll('input:checked'), function (i) { return i.value; });
    try {
      await call('save_position', {
        p_club: cid, p_id: editing, p_title: $('pe-name').value, p_level: Number($('pe-level').value),
        p_scope: $('pe-scope').value, p_permissions: perms, p_parent: null
      });
      flash('success', 'Position saved.'); resetEditor(); await load();
    } catch (err) { fail(err); }
  });
  $('pe-std').addEventListener('click', async function () {
    try {
      var n = await call('apply_role_templates', { p_club: cid });
      flash('success', n ? n + ' standard position(s) added.' : 'All standard positions already exist.');
      await load();
    } catch (err) { fail(err); }
  });

  $('t-add').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('t-name').value.trim();
    if (!name) return;
    var r = await sb.from('teams').insert({ club_id: cid, name: name });
    if (r.error) return fail(r.error.code === '23505' ? { message: 'A team with that name already exists.' } : r.error);
    $('t-name').value = ''; flash('success', 'Team added.'); await load();
  });
  $('t-list').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-delteam]');
    if (!b) return;
    if (!await REMS.confirm('Delete the team "' + b.getAttribute('data-name') + '"?', { title: 'Delete team', ok: 'Delete', danger: true })) return;
    var r = await sb.from('teams').delete().eq('id', Number(b.getAttribute('data-delteam')));
    if (r.error) return fail(r.error.code === '23503' ? { message: 'This team still has members or position holders, so it cannot be deleted.' } : r.error);
    flash('success', 'Team deleted.'); await load();
  });

  await load();
})();
