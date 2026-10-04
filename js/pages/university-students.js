/* University admin: import the admitted-student list (CSV) and browse it. All writes go through the
 * import_students() database function; Row Level Security limits reading to university admins. */
(async function () {
  'use strict';
  document.title = 'Student List: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ univ: true }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var CHUNK = 500, PAGE = 25, MAX_ROWS = 20000;
  var rows = [], page = 0, total = 0, term = '';

  function flash(kind, html) { if (REMS.toastIfShort(kind, html)) { $('msg').innerHTML = ''; return; } $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
    '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>'; window.scrollTo(0, 0); }

  // ---- CSV (comma, semicolon or tab separated; quoted cells allowed) ----
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/, 1)[0];
    var sep = [',', ';', '\t'].map(function (s) { return [s, first.split(s).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var out = [], cur = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { cur.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(cell); cell = ''; if (cur.some(function (c) { return c.trim(); })) out.push(cur); cur = []; }
      else cell += ch;
    }
    cur.push(cell); if (cur.some(function (c) { return c.trim(); })) out.push(cur);
    return out;
  }
  var ALIAS = {
    institute_email: ['institute_email', 'email', 'e-mail', 'mail'],
    enrolment_no: ['enrolment_no', 'enrolment', 'enrollment_no', 'enrollment', 'regno', 'reg_no', 'roll_no', 'rollno'],
    full_name: ['full_name', 'name', 'student_name'],
    department: ['department', 'dept', 'branch'],
    programme: ['programme', 'program', 'course'],
    batch: ['batch', 'year', 'admission_year']
  };
  function readStudents(text) {
    var t = parseCsv(text);
    if (t.length < 2) throw new Error('The file has no data rows.');
    var head = t[0].map(function (h) { return h.trim().toLowerCase().replace(/[\s-]+/g, '_'); });
    var idx = {};
    Object.keys(ALIAS).forEach(function (k) { idx[k] = head.findIndex(function (h) { return ALIAS[k].indexOf(h) > -1; }); });
    ['institute_email', 'enrolment_no', 'full_name'].forEach(function (k) { if (idx[k] < 0) throw new Error('Missing column: ' + k); });
    if (t.length - 1 > MAX_ROWS) throw new Error('Too many rows (limit ' + MAX_ROWS + ' per file).');
    return t.slice(1).map(function (r) {
      var o = {};
      Object.keys(idx).forEach(function (k) { o[k] = idx[k] > -1 ? String(r[idx[k]] || '').trim() : ''; });
      return o;
    });
  }

  $('csv-file').addEventListener('change', async function () {
    var f = this.files[0]; rows = []; $('imp-btn').disabled = true; $('imp-result').innerHTML = '';
    $('csv-label').textContent = f ? f.name : 'Choose file...';
    if (!f) { $('csv-info').innerHTML = ''; return; }
    try {
      rows = readStudents(await f.text());
      $('csv-info').innerHTML = '<div class="alert alert-info mb-0">' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' ready. First: <strong>' + esc(rows[0].full_name) + '</strong> (' + esc(rows[0].institute_email) + ').</div>';
      $('imp-btn').disabled = false;
    } catch (err) {
      $('csv-info').innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>';
    }
  });

  function csvSafe(v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }

  $('imp-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!rows.length) return;
    $('imp-btn').disabled = true;
    var ins = 0, upd = 0, bad = [];
    try {
      for (var i = 0; i < rows.length; i += CHUNK) {
        $('imp-result').innerHTML = '<div class="alert alert-info mb-0">Importing ' + Math.min(i + CHUNK, rows.length) + ' of ' + rows.length + '...</div>';
        var r = await sb.rpc('import_students', { p_rows: rows.slice(i, i + CHUNK) });
        if (r.error) throw r.error;
        ins += r.data.inserted; upd += r.data.updated;
        r.data.rejected.forEach(function (b) { b.row += i; bad.push(b); });
      }
      await REMS.log('Imported student list: ' + ins + ' new, ' + upd + ' updated, ' + bad.length + ' rejected');
      var html = '<div class="alert alert-' + (bad.length ? 'warning' : 'success') + ' mb-2">' + ins + ' added, ' + upd + ' updated, ' + bad.length + ' rejected.</div>';
      if (bad.length) {
        html += '<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Row</th><th>E-mail</th><th>Problem</th></tr></thead><tbody>' +
          bad.slice(0, 200).map(function (b) { return '<tr><td>' + (b.row + 1) + '</td><td>' + esc(b.email) + '</td><td>' + esc(b.error) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          (bad.length > 200 ? '<p class="small text-muted">Showing the first 200. Download the full list below.</p>' : '') +
          '<button class="btn btn-outline-primary btn-sm" type="button" id="dl-bad"><i class="fas fa-download mr-1"></i>Download rejected rows</button>';
      }
      $('imp-result').innerHTML = html;
      var dl = $('dl-bad');
      if (dl) dl.addEventListener('click', function () {
        var csv = 'row,email,problem\r\n' + bad.map(function (b) { return [b.row + 1, b.email, b.error].map(csvSafe).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'rejected-students.csv'; a.click();
      });
      rows = []; $('csv-file').value = ''; $('csv-label').textContent = 'Choose file...'; $('csv-info').innerHTML = '';
      await loadStats(); page = 0; await loadList();
    } catch (err) {
      console.error(err);
      $('imp-result').innerHTML = '<div class="alert alert-danger mb-0">Import stopped: ' + esc(err.message || 'unknown error') +
        '. ' + ins + ' added and ' + upd + ' updated before it stopped; importing again is safe.</div>';
      $('imp-btn').disabled = false;
    }
  });

  // ---- stats and list ----
  async function count(filter) {
    var q = sb.from('students').select('id', { count: 'exact', head: true });
    if (filter) q = filter(q);
    var r = await q; return r.error ? 0 : r.count;
  }
  async function loadStats() {
    var all = await count(), claimed = await count(function (q) { return q.not('profile_id', 'is', null); });
    $('stat-total').textContent = all; $('stat-claimed').textContent = claimed; $('stat-open').textContent = all - claimed;
  }
  async function loadList() {
    var q = sb.from('students').select('institute_email,enrolment_no,full_name,department,batch,status,profile_id', { count: 'exact' });
    if (term) {
      q = q.or('institute_email.ilike.*' + term + '*,enrolment_no.ilike.*' + term + '*,full_name.ilike.*' + term + '*');
    }
    var r = await q.order('enrolment_no').range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) { $('students-body').innerHTML = '<tr><td colspan="6" class="text-danger">' + esc(r.error.message) + '</td></tr>'; return; }
    total = r.count || 0;
    $('students-body').innerHTML = r.data.length ? r.data.map(function (s) {
      return '<tr><td>' + esc(s.institute_email) + '</td><td>' + esc(s.enrolment_no) + '</td><td>' + esc(s.full_name) + '</td><td>' + esc(s.department || '') +
        '</td><td>' + esc(s.batch || '') + '</td><td><span class="badge badge-' + (s.profile_id ? 'success' : 'secondary') + '">' + (s.profile_id ? esc(s.status) : 'not claimed') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="text-center text-muted py-3">No students found.</td></tr>';
    var last = Math.max(0, Math.ceil(total / PAGE) - 1);
    $('page-info').textContent = total ? 'Page ' + (page + 1) + ' of ' + (last + 1) + ' (' + total + ')' : '';
    $('prev').disabled = page <= 0; $('next').disabled = page >= last;
  }
  var timer;
  $('q').addEventListener('input', function () {
    var v = this.value.replace(/[^A-Za-z0-9@._ -]/g, '').trim();
    clearTimeout(timer); timer = setTimeout(function () { term = v; page = 0; loadList(); }, 300);
  });
  $('prev').addEventListener('click', function () { if (page > 0) { page--; loadList(); } });
  $('next').addEventListener('click', function () { page++; loadList(); });

  await loadStats(); await loadList();
})();
