/* Mailing lists (admin): create a list from a CSV, add people later, browse and delete.
 * Tables: public.mailing_lists and public.mailing_list_members (admin-only by RLS).
 */
(async function () {
  'use strict';
  document.title = 'Mailing Lists: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'mail.send' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_ROWS = 5000, CHUNK = 500, PAGE = 20;
  var EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
  var people = [];          // parsed from the chosen CSV
  var lists = [];           // [{id, name, created_at, count}]
  var open = null;          // list being browsed
  var page = 0;

  function flash(kind, html) {
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }
  function fmtDate(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(); }
  function cleanName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 100) || null; }

  // ---------------- CSV (same rules as the certificate generator) ----------------
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var first = text.split(/\r\n|\n|\r/)[0] || '';
    var delim = ',';
    if (first.indexOf(',') === -1) { if (first.indexOf(';') > -1) delim = ';'; else if (first.indexOf('\t') > -1) delim = '\t'; }
    var rows = [], row = [], cell = '', q = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { q = true; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = ''; i++; continue;
      }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  // -> { people, errors, skipped: {invalid, duplicate} }
  function readPeople(text) {
    var out = { people: [], errors: [], invalid: [], duplicates: 0 };
    var table = parseCsv(text);
    if (!table.length) { out.errors.push('The file is empty.'); return out; }
    var head = table[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var ni = head.indexOf('name'), ei = head.indexOf('email');
    if (ei === -1) out.errors.push('Missing column "email". Columns found: ' + head.join(', '));
    if (ni === -1) out.errors.push('Missing column "name". Columns found: ' + head.join(', '));
    if (out.errors.length) return out;
    if (table.length - 1 > MAX_ROWS) { out.errors.push('At most ' + MAX_ROWS + ' rows per file (this one has ' + (table.length - 1) + ').'); return out; }
    var seen = {};
    for (var r = 1; r < table.length; r++) {
      var email = String(table[r][ei] == null ? '' : table[r][ei]).trim();
      if (!EMAIL_RE.test(email) || email.length > 200) { out.invalid.push('Line ' + (r + 1) + ': "' + email.slice(0, 40) + '"'); continue; }
      var key = email.toLowerCase();
      if (seen[key]) { out.duplicates++; continue; }
      seen[key] = true;
      out.people.push({ name: cleanName(table[r][ni]), email: email });
    }
    return out;
  }

  $('csv-file').addEventListener('change', async function () {
    var f = this.files[0];
    $('csv-info').innerHTML = ''; people = [];
    $('csv-label').textContent = f ? f.name : 'Choose file...';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { $('csv-info').innerHTML = '<div class="alert alert-danger py-2 mb-0">That file is larger than 2 MB. Is it really a list of names?</div>'; return; }
    var res = readPeople(await f.text());
    var html = '';
    if (res.errors.length) {
      html += '<div class="alert alert-danger py-2 mb-1"><strong>Please fix the file and choose it again:</strong><ul class="mb-0 pl-4">' +
        res.errors.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
    } else {
      people = res.people;
      html += '<div class="alert alert-success py-2 mb-1"><i class="fas fa-check mr-1"></i>' + people.length + ' valid addresses found (' + esc(f.name) + ').' +
        (res.duplicates ? ' ' + res.duplicates + ' repeated address(es) ignored.' : '') + '</div>';
      if (res.invalid.length) {
        html += '<div class="alert alert-warning py-2 mb-1">' + res.invalid.length + ' row(s) skipped because the e-mail looks wrong:<br><small>' +
          res.invalid.slice(0, 6).map(esc).join('<br>') + (res.invalid.length > 6 ? '<br>&hellip;' : '') + '</small></div>';
      }
      if (!$('list-name').value.trim()) $('list-name').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80);
      syncHint();
    }
    $('csv-info').innerHTML = html;
  });

  function findList(name) {
    var k = name.trim().toLowerCase();
    return lists.filter(function (l) { return l.name.toLowerCase() === k; })[0] || null;
  }
  function syncHint() {
    var name = $('list-name').value.trim();
    var l = name && findList(name);
    $('name-hint').textContent = l ? 'This list exists (' + l.count + ' people). The new people will be added to it.'
                                   : 'A new name creates a new list. An existing name adds the new people to that list.';
  }
  $('list-name').addEventListener('input', syncHint);

  // ---------------- lists ----------------
  async function loadLists() {
    var r = await sb.from('mailing_lists').select('id,name,created_at,mailing_list_members(count)').eq('club_id', REMS.clubId()).order('created_at', { ascending: false });
    if (r.error) { $('lists-body').innerHTML = '<tr><td colspan="4" class="text-danger">' + esc(r.error.message) + '</td></tr>'; return; }
    lists = r.data.map(function (l) {
      return { id: l.id, name: l.name, created_at: l.created_at, count: (l.mailing_list_members && l.mailing_list_members[0] && l.mailing_list_members[0].count) || 0 };
    });
    $('existing-lists').innerHTML = lists.map(function (l) { return '<option value="' + esc(l.name) + '">'; }).join('');
    $('lists-body').innerHTML = lists.length ? lists.map(function (l) {
      return '<tr><td>' + esc(l.name) + '</td><td class="text-center">' + l.count + '</td><td>' + esc(fmtDate(l.created_at)) + '</td>' +
        '<td class="text-right text-nowrap">' +
        '<button class="btn btn-sm btn-outline-primary mr-1 act-view" data-id="' + l.id + '"><i class="fas fa-eye"></i> View</button>' +
        '<button class="btn btn-sm btn-outline-secondary mr-1 act-dl" data-id="' + l.id + '"><i class="fas fa-download"></i> CSV</button>' +
        '<button class="btn btn-sm btn-outline-danger act-del" data-id="' + l.id + '"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('') : '<tr><td colspan="4" class="text-muted">No lists yet. Create one above.</td></tr>';
    syncHint();
  }
  function byId(id) { return lists.filter(function (l) { return String(l.id) === String(id); })[0]; }

  $('up-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('list-name').value.replace(/\s+/g, ' ').trim();
    if (!people.length) return flash('warning', 'Choose a CSV file with at least one valid address first.');
    if (!name) return flash('warning', 'Give the list a name.');
    $('up-btn').disabled = true;
    try {
      var list = findList(name), created = false;
      if (!list) {
        var c = await sb.from('mailing_lists').insert({ club_id: REMS.clubId(), name: name.slice(0, 80) }).select('id,name').single();
        if (c.error) throw c.error;
        list = { id: c.data.id, name: c.data.name }; created = true;
      }
      // skip addresses the list already has
      var have = {};
      if (!created) {
        for (var from = 0; ; from += 1000) {
          var ex = await sb.from('mailing_list_members').select('email').eq('list_id', list.id).order('id').range(from, from + 999);
          if (ex.error) throw ex.error;
          ex.data.forEach(function (m) { have[m.email.toLowerCase()] = true; });
          if (ex.data.length < 1000) break;
        }
      }
      var fresh = people.filter(function (p) { return !have[p.email.toLowerCase()]; });
      for (var i = 0; i < fresh.length; i += CHUNK) {
        var rows = fresh.slice(i, i + CHUNK).map(function (p) { return { list_id: list.id, name: p.name, email: p.email }; });
        var ins = await sb.from('mailing_list_members').insert(rows);
        if (ins.error) throw ins.error;
      }
      await REMS.log((created ? 'Created mailing list "' : 'Added ' + fresh.length + ' people to mailing list "') + list.name + '"' + (created ? ' with ' + fresh.length + ' people' : ''));
      flash('success', (created ? 'Created <strong>' + esc(list.name) + '</strong> with ' : 'Added ') + fresh.length + ' people' +
        (fresh.length < people.length ? ' (' + (people.length - fresh.length) + ' were already in the list)' : '') + '.');
      people = []; $('csv-file').value = ''; $('csv-label').textContent = 'Choose file...'; $('csv-info').innerHTML = ''; $('list-name').value = '';
      await loadLists();
      if (open && open.id === list.id) await showMembers(list.id, 0);
    } catch (err) {
      flash('danger', 'Could not save the list: ' + esc(err.message || err));
      await loadLists();
    } finally { $('up-btn').disabled = false; }
  });

  // ---------------- members ----------------
  async function showMembers(id, p) {
    var l = byId(id); if (!l) return;
    open = l; page = Math.max(0, p);
    $('members-card').style.display = '';
    $('members-title').textContent = 'Members of ' + l.name;
    $('members-body').innerHTML = '<tr><td colspan="3" class="text-muted">Loading&hellip;</td></tr>';
    var r = await sb.from('mailing_list_members').select('id,name,email', { count: 'exact' }).eq('list_id', l.id).order('id').range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) { $('members-body').innerHTML = '<tr><td colspan="3" class="text-danger">' + esc(r.error.message) + '</td></tr>'; return; }
    l.count = r.count || 0;
    $('members-body').innerHTML = r.data.length ? r.data.map(function (m) {
      return '<tr><td>' + esc(m.name || '') + '</td><td>' + esc(m.email) + '</td>' +
        '<td class="text-right"><button class="btn btn-sm btn-outline-danger act-rm" data-id="' + m.id + '" title="Remove"><i class="fas fa-times"></i></button></td></tr>';
    }).join('') : '<tr><td colspan="3" class="text-muted">This list is empty.</td></tr>';
    var last = Math.max(0, Math.ceil(l.count / PAGE) - 1);
    $('members-info').textContent = l.count ? 'Showing ' + (page * PAGE + 1) + '-' + (page * PAGE + r.data.length) + ' of ' + l.count : '';
    $('members-prev').disabled = page <= 0;
    $('members-next').disabled = page >= last;
    $('members-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('members-prev').addEventListener('click', function () { if (open) showMembers(open.id, page - 1); });
  $('members-next').addEventListener('click', function () { if (open) showMembers(open.id, page + 1); });
  $('members-close').addEventListener('click', function () { open = null; $('members-card').style.display = 'none'; });

  $('add-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!open) return;
    var email = $('add-email').value.trim();
    if (!EMAIL_RE.test(email)) return flash('warning', 'That e-mail address looks wrong.');
    var r = await sb.from('mailing_list_members').insert({ list_id: open.id, name: cleanName($('add-name').value), email: email });
    if (r.error) return flash(r.error.code === '23505' ? 'warning' : 'danger', r.error.code === '23505' ? 'That address is already in the list.' : esc(r.error.message));
    await REMS.log('Added ' + email + ' to mailing list "' + open.name + '"');
    $('add-name').value = ''; $('add-email').value = '';
    var id = open.id;
    await loadLists(); await showMembers(id, page);
  });

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('act-view')) return showMembers(b.dataset.id, 0);
    if (b.classList.contains('act-rm')) {
      if (!open || !confirm('Remove this person from the list?')) return;
      var r = await sb.from('mailing_list_members').delete().eq('id', b.dataset.id);
      if (r.error) return flash('danger', esc(r.error.message));
      await REMS.log('Removed a person from mailing list "' + open.name + '"');
      var id = open.id; await loadLists(); await showMembers(id, page);
    } else if (b.classList.contains('act-del')) {
      var l = byId(b.dataset.id); if (!l) return;
      if (!confirm('Delete the list "' + l.name + '" and its ' + l.count + ' people? This cannot be undone.')) return;
      var d = await sb.from('mailing_lists').delete().eq('id', l.id);
      if (d.error) return flash('danger', esc(d.error.message));
      await REMS.log('Deleted mailing list "' + l.name + '"');
      if (open && open.id === l.id) { open = null; $('members-card').style.display = 'none'; }
      flash('success', 'Deleted <strong>' + esc(l.name) + '</strong>.');
      loadLists();
    } else if (b.classList.contains('act-dl')) {
      var L = byId(b.dataset.id); if (!L) return;
      b.disabled = true;
      try { await downloadCsv(L); } catch (err) { flash('danger', esc(err.message || err)); } finally { b.disabled = false; }
    }
  });

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;       // never let a spreadsheet run list data as a formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function downloadCsv(l) {
    var rows = [];
    for (var from = 0; ; from += 1000) {
      var r = await sb.from('mailing_list_members').select('name,email').eq('list_id', l.id).order('id').range(from, from + 999);
      if (r.error) throw r.error;
      rows = rows.concat(r.data);
      if (r.data.length < 1000) break;
    }
    var csv = 'name,email\r\n' + rows.map(function (m) { return csvCell(m.name) + ',' + csvCell(m.email); }).join('\r\n') + '\r\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (l.name.replace(/[^\w.-]+/g, '_') || 'mailing_list') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  await loadLists();
})();
