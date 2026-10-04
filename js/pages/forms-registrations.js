/* View registrations (admin): browse answers for one form and export them as CSV. */
(async function () {
  'use strict';
  document.title = 'Registrations: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'form.manage' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var slug = (params.get('form') || '').trim();
  var perPage = [10, 25, 50, 100].indexOf(parseInt(params.get('perPage'), 10)) > -1 ? parseInt(params.get('perPage'), 10) : 10;
  var page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  var form = null, rows = [], total = 0;

  function flash(kind, text) {
    if (REMS.toastIfShort(kind, esc(text))) { $('msg').innerHTML = ''; return; }
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + esc(text) +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
  }
  function url(p, s) {
    var q = new URLSearchParams();
    q.set('form', s || slug);
    if (perPage !== 10) q.set('perPage', perPage);
    q.set('page', p);
    return 'forms-registrations.html?' + q.toString();
  }

  // ---- column logic (matches the key naming in register.js) ----
  function baseColumns(f) {
    var fields = Array.isArray(f.fields) ? f.fields.filter(function (x) { return typeof x === 'string' && x; }) : [];
    var team = f.event_type === 'team';
    var n = team ? Math.max(1, f.number_participants || 1) : 1;
    var cols = [];
    for (var p = 1; p <= n; p++) fields.forEach(function (l) { cols.push(team ? l + p : l); });
    return cols;
  }
  // Answers whose key is not in the form definition (e.g. the form was changed later) still show up.
  function withExtras(cols, dataRows) {
    var seen = {}, out = cols.slice();
    cols.forEach(function (c) { seen[c] = true; });
    dataRows.forEach(function (d) {
      Object.keys(d || {}).forEach(function (k) { if (!seen[k]) { seen[k] = true; out.push(k); } });
    });
    return out;
  }
  function val(d, k) {
    var v = d ? d[k] : undefined;
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  // ---- CSV helpers ----
  // Cells that start with = + - @ (or tab/CR) are prefixed with ' so Excel/Sheets never run them as formulas:
  // registrations are typed in by the public, so treat them as untrusted.
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(arr) { return arr.map(csvCell).join(','); }

  // ---- load the form list ----
  var fr = await sb.from('forms').select('id,slug,name,event_type,number_participants,fields').eq('club_id', REMS.clubId()).order('id', { ascending: false });
  if (fr.error) { flash('danger', 'Could not load forms: ' + fr.error.message); return; }
  var forms = fr.data;
  $('form-select').innerHTML = '<option value=""' + (slug ? '' : ' selected') + ' disabled>Select an event to view registrations</option>' +
    forms.map(function (f) { return '<option value="' + esc(f.slug) + '"' + (f.slug === slug ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('');
  $('form-select').addEventListener('change', function () { if (this.value) location.href = url(1, this.value); });
  $('per-page').value = perPage;
  $('per-page').addEventListener('change', function () { perPage = parseInt(this.value, 10); location.href = url(1); });

  if (!forms.length) { flash('info', 'No forms yet. Create one on the Event forms page.'); return; }
  if (!slug) return;
  form = forms.filter(function (f) { return f.slug === slug; })[0];
  if (!form) { flash('warning', 'No form found for "' + slug + '".'); return; }

  $('card-title').textContent = 'Registrations: ' + form.name;
  $('actions').style.display = '';
  $('grid-wrap').style.display = '';
  $('share-link').href = new URL('register.html?form=' + encodeURIComponent(form.slug), location.href).href;

  // ---- table ----
  function pager() {
    var pages = Math.ceil(total / perPage);
    if (pages <= 1) return '';
    var h = '<nav aria-label="Registration pages"><ul class="pagination justify-content-md-end flex-wrap mb-0">';
    h += '<li class="page-item' + (page <= 1 ? ' disabled' : '') + '"><a class="page-link" href="' + esc(url(page - 1)) + '">&laquo;</a></li>';
    var last = 0;
    for (var i = 1; i <= pages; i++) {
      if (i !== 1 && i !== pages && Math.abs(i - page) > 2) continue;
      if (i - last > 1) h += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
      h += i === page ? '<li class="page-item active"><span class="page-link">' + i + '</span></li>'
        : '<li class="page-item"><a class="page-link" href="' + esc(url(i)) + '">' + i + '</a></li>';
      last = i;
    }
    h += '<li class="page-item' + (page >= pages ? ' disabled' : '') + '"><a class="page-link" href="' + esc(url(page + 1)) + '">&raquo;</a></li>';
    return h + '</ul></nav>';
  }

  function fmt(ts) {
    var d = new Date(ts);
    return isNaN(d) ? esc(ts) : esc(d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  }

  function render() {
    $('total').textContent = total + ' registration' + (total === 1 ? '' : 's');
    var cols = withExtras(baseColumns(form), rows.map(function (r) { return r.data; }));
    $('grid-head').innerHTML = '<th>#</th><th class="text-nowrap">Submitted</th>' +
      cols.map(function (c) { return '<th class="text-nowrap">' + esc(c) + '</th>'; }).join('') + '<th></th>';
    if (!rows.length) {
      $('grid-body').innerHTML = '<tr><td colspan="' + (cols.length + 3) + '" class="text-center text-muted py-4">No registrations found for this event.</td></tr>';
      $('info').textContent = ''; $('pager').innerHTML = '';
      return;
    }
    var start = (page - 1) * perPage;
    $('grid-body').innerHTML = rows.map(function (r, i) {
      return '<tr><td>' + (start + i + 1) + '</td><td class="text-nowrap">' + fmt(r.created_at) + '</td>' +
        cols.map(function (c) { return '<td>' + esc(val(r.data, c)) + '</td>'; }).join('') +
        '<td class="text-center"><button class="btn btn-danger btn-sm" type="button" data-i="' + i + '" aria-label="Delete registration"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
    $('info').textContent = 'Showing ' + (start + 1) + ' to ' + (start + rows.length) + ' of ' + total + ' registrations';
    $('pager').innerHTML = pager();
  }

  async function load() {
    var r;
    for (var attempt = 0; attempt < 2; attempt++) {
      var from = (page - 1) * perPage;
      r = await sb.from('form_responses').select('id,created_at,data', { count: 'exact' })
        .eq('form_id', form.id).order('id').range(from, from + perPage - 1);
      if (r.error && r.error.code === 'PGRST103' && page > 1) { page = 1; continue; }   // past the last page
      break;
    }
    if (r.error) { flash('danger', 'Could not load registrations: ' + r.error.message); return; }
    rows = r.data; total = r.count || 0;
    render();
  }

  $('grid-body').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b) return;
    var row = rows[parseInt(b.dataset.i, 10)];
    if (!await REMS.confirm('Delete this registration? This cannot be undone.', { title: 'Delete registration', ok: 'Delete', danger: true })) return;
    b.disabled = true;
    var r = await sb.from('form_responses').delete().eq('id', row.id).select('id');
    if (r.error) { flash('danger', 'Delete failed: ' + r.error.message); b.disabled = false; return; }
    if (!r.data.length) { flash('warning', 'Nothing was deleted (it may already be gone).'); b.disabled = false; return; }
    await REMS.log('Removed registration id=' + row.id + ' from ' + form.slug);
    flash('success', 'Registration deleted.');
    await load();
  });

  // ---- CSV download (fetches every row, not just the visible page) ----
  $('csv-btn').addEventListener('click', async function () {
    var btn = this, label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Preparing...';
    try {
      var all = [], from = 0;
      for (;;) {                                   // loop until empty: works whatever the API row cap is
        var r = await sb.from('form_responses').select('id,created_at,data').eq('form_id', form.id).order('id').range(from, from + 999);
        if (r.error) throw r.error;
        if (!r.data.length) break;
        all = all.concat(r.data);
        from += r.data.length;
      }
      var cols = withExtras(baseColumns(form), all.map(function (x) { return x.data; }));
      var lines = [csvLine(['id', 'submitted_at'].concat(cols))];
      all.forEach(function (x) {
        lines.push(csvLine([x.id, x.created_at].concat(cols.map(function (c) { return val(x.data, c); }))));
      });
      var blob = new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });   // BOM: Excel reads UTF-8
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = form.slug.replace(/[^A-Za-z0-9_-]/g, '_') + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      await REMS.log('Downloaded CSV for ' + form.slug);
      flash('success', 'Downloaded ' + all.length + ' registration' + (all.length === 1 ? '' : 's') + '.');
    } catch (err) {
      console.error(err);
      flash('danger', 'Could not build the CSV: ' + (err.message || 'unknown error'));
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });

  await load();
})();
