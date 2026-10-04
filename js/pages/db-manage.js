(async function () {
  'use strict';
  document.title = 'Platform tools: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ admin: true }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var NO_INSERT = ['profiles'];
  var NO_DELETE = ['profiles'];
  var LOCKED = { profiles: ['email', 'created_at'] };
  var HIDDEN = { certificates: ['email'] };
  var NEWEST_FIRST = ['logging', 'notification', 'form_responses'];
  var INT_TYPES = ['smallint', 'integer', 'bigint'];

  var params = new URLSearchParams(location.search);
  var table = params.get('table') || '';
  var perPage = [10, 25, 50, 100].indexOf(parseInt(params.get('perPage'), 10)) > -1 ? parseInt(params.get('perPage'), 10) : 10;
  var page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  var tables = [], columns = [], rows = [], total = 0;
  var editing = null;

  function flash(kind, text, target) {
    if (!target && REMS.toastIfShort(kind, esc(text))) { $('msg').innerHTML = ''; return; }
    $(target || 'msg').innerHTML = '<div class="alert alert-' + kind + '" role="alert">' + esc(text) + '</div>';
  }
  function url(p, t) {
    var q = new URLSearchParams();
    q.set('table', t || table);
    if (perPage !== 10) q.set('perPage', perPage);
    q.set('page', p);
    return 'db-manage.html?' + q.toString();
  }

  var tl = await sb.rpc('admin_list_tables');
  if (tl.error) { flash('danger', 'Could not list tables: ' + tl.error.message + '. Did you run 0003_admin_list_columns.sql?'); return; }
  tables = tl.data.map(function (r) { return r.table_name; });
  $('table-select').innerHTML = '<option value="">Select a table</option>' + tables.map(function (t) {
    return '<option value="' + esc(t) + '"' + (t === table ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('');
  $('table-select').addEventListener('change', function () { if (this.value) location.href = url(1, this.value); });
  $('per-page').value = perPage;
  $('per-page').addEventListener('change', function () { perPage = parseInt(this.value, 10); location.href = url(1); });

  if (!table) return;
  if (tables.indexOf(table) === -1) { flash('warning', 'Unknown table "' + table + '".'); return; }

  $('card-title').textContent = 'Table: ' + table;
  var cr = await sb.rpc('admin_list_columns', { tbl: table });
  if (cr.error) { flash('danger', 'Could not read columns: ' + cr.error.message + '. Did you run 0003_admin_list_columns.sql?'); return; }
  columns = cr.data.filter(function (c) { return (HIDDEN[table] || []).indexOf(c.column_name) === -1; });
  function colList() { return columns.map(function (c) { return c.column_name; }).join(','); }
  var hasId = columns.some(function (c) { return c.column_name === 'id'; });
  if (NO_INSERT.indexOf(table) === -1) $('add-btn').style.display = '';

  async function load() {
    var r;
    for (var attempt = 0; attempt < 2; attempt++) {
      var from = (page - 1) * perPage;
      var q = sb.from(table).select(colList(), { count: 'exact' });
      if (hasId) q = q.order('id', { ascending: NEWEST_FIRST.indexOf(table) === -1 });
      r = await q.range(from, from + perPage - 1);
      if (r.error && r.error.code === 'PGRST103' && page > 1) { page = 1; continue; }
      break;
    }
    if (r.error) { flash('danger', 'Could not load rows: ' + r.error.message); return; }
    rows = r.data; total = r.count || 0;
    render();
  }

  function cell(col, v) {
    if (v === null || v === undefined) return '<span class="text-muted">null</span>';
    if (col === 'cert_link' && /^https?:\/\//i.test(v)) return '<a href="' + esc(v) + '" target="_blank" rel="noopener">Link</a>';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    var short = s.length > 80 ? s.slice(0, 80) + '\u2026' : s;
    return '<span title="' + esc(s.slice(0, 500)) + '">' + esc(short) + '</span>';
  }

  function pager() {
    var pages = Math.ceil(total / perPage);
    if (pages <= 1) return '';
    var h = '<nav aria-label="Table pages"><ul class="pagination justify-content-md-end flex-wrap mb-0">';
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

  function render() {
    $('total-rows').textContent = total;
    $('grid-head').innerHTML = columns.map(function (c) { return '<th class="text-nowrap">' + esc(c.column_name) + '</th>'; }).join('') + '<th></th>';
    if (!rows.length) {
      $('grid-body').innerHTML = '<tr><td colspan="' + (columns.length + 1) + '" class="text-center text-muted py-4">This table is empty.</td></tr>';
      $('info').textContent = ''; $('pager').innerHTML = '';
      return;
    }
    var canDelete = hasId && NO_DELETE.indexOf(table) === -1;
    $('grid-body').innerHTML = rows.map(function (row, i) {
      var tds = columns.map(function (c) { return '<td>' + cell(c.column_name, row[c.column_name]) + '</td>'; }).join('');
      var btns = hasId
        ? '<button class="btn btn-info btn-sm mr-1" data-act="edit" data-i="' + i + '" aria-label="Edit row"><i class="fas fa-edit"></i></button>' +
          (canDelete ? '<button class="btn btn-danger btn-sm" data-act="del" data-i="' + i + '" aria-label="Delete row"><i class="fas fa-trash"></i></button>' : '')
        : '';
      return '<tr>' + tds + '<td class="text-nowrap text-center">' + btns + '</td></tr>';
    }).join('');
    var start = (page - 1) * perPage + 1;
    $('info').textContent = 'Showing ' + start + ' to ' + (start + rows.length - 1) + ' of ' + total + ' rows';
    $('pager').innerHTML = pager();
  }

  function strVal(v) {
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
  }

  function fieldHtml(c, v, isEdit) {
    var id = 'f-' + c.column_name, name = esc(c.column_name), t = c.data_type;
    var readonly = isEdit && (c.column_name === 'id' || (LOCKED[table] || []).indexOf(c.column_name) > -1);
    var hint = !isEdit && (c.is_identity || c.has_default) ? 'leave blank for default' : (c.is_nullable ? 'optional' : 'required');
    var label = '<label for="' + id + '" class="font-weight-bold mb-1">' + name +
      ' <small class="text-muted font-weight-normal">' + esc(t) + ' &middot; ' + hint + '</small></label>';
    var s = strVal(v), input;
    if (readonly) {
      input = '<input id="' + id + '" class="form-control" value="' + esc(s) + '" readonly>';
    } else if (t === 'boolean') {
      var cur = v === true ? 'true' : v === false ? 'false' : '';
      input = '<select id="' + id + '" class="form-control">' +
        ['', 'true', 'false'].map(function (o) { return '<option value="' + o + '"' + (o === cur ? ' selected' : '') + '>' + (o || '\u2014') + '</option>'; }).join('') + '</select>';
    } else if (t === 'jsonb' || t === 'json' || s.length > 100 || s.indexOf('\n') > -1) {
      input = '<textarea id="' + id + '" class="form-control" rows="' + (t === 'jsonb' || t === 'json' ? 5 : 3) + '">' + esc(s) + '</textarea>';
    } else {
      input = '<input id="' + id + '" class="form-control" type="' + (t === 'date' ? 'date' : 'text') + '" value="' + esc(s) + '">';
    }
    return '<div class="form-group" data-col="' + name + '">' + label + input + '<div class="invalid-feedback d-block text-danger small"></div></div>';
  }

  function parse(c, raw, isEdit) {
    var t = c.data_type, s = raw.trim();
    if (s === '') {
      if (!isEdit && (c.is_identity || c.has_default || c.is_nullable)) return { skip: true };
      if (c.is_nullable) return { value: null };
      return { error: 'Required.' };
    }
    if (t === 'boolean') return { value: s === 'true' };
    if (INT_TYPES.indexOf(t) > -1) {
      if (!/^-?\d+$/.test(s)) return { error: 'Whole number expected.' };
      var n = Number(s);
      return Number.isSafeInteger(n) ? { value: n } : { value: s };
    }
    if (t === 'numeric' || t === 'real' || t === 'double precision') {
      return isFinite(Number(s)) ? { value: Number(s) } : { error: 'Number expected.' };
    }
    if (t === 'jsonb' || t === 'json') {
      try { return { value: JSON.parse(s) }; } catch (e) { return { error: 'Invalid JSON.' }; }
    }
    return { value: raw };
  }

  function openModal(row) {
    editing = row;
    $('modal-msg').innerHTML = '';
    $('modal-title').textContent = row ? 'Edit row ' + row.id + ' in ' + table : 'Add row to ' + table;
    var cols = columns.filter(function (c) { return row || !c.is_identity; });
    $('modal-fields').innerHTML = cols.map(function (c) { return fieldHtml(c, row ? row[c.column_name] : null, !!row); }).join('');
    $('modal-fields').dataset.cols = JSON.stringify(cols.map(function (c) { return c.column_name; }));
    $('row-modal').dataset.mode = row ? 'edit' : 'add';
    window.jQuery('#row-modal').modal('show');
  }

  $('add-btn').addEventListener('click', function () { openModal(null); });
  $('grid-body').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var row = rows[parseInt(b.dataset.i, 10)];
    if (b.dataset.act === 'edit') return openModal(row);
    if (!await REMS.confirm('Delete row ' + row.id + ' from "' + table + '"? This cannot be undone.', { title: 'Delete row', ok: 'Delete', danger: true })) return;
    b.disabled = true;
    var r = await sb.from(table).delete().eq('id', row.id).select(colList());
    if (r.error) { flash('danger', 'Delete failed: ' + r.error.message); b.disabled = false; return; }
    if (!r.data.length) { flash('warning', 'Nothing was deleted (the row may already be gone).'); b.disabled = false; return; }
    await REMS.log('Removed id=' + row.id + ' from ' + table);
    flash('success', 'Row ' + row.id + ' deleted.');
    await load();
  });

  $('row-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('modal-msg').innerHTML = '';
    var isEdit = !!editing, payload = {}, bad = false;
    columns.forEach(function (c) {
      var el = $('f-' + c.column_name), box = el && el.closest('.form-group');
      if (!el || el.readOnly) return;
      var p = parse(c, el.value, isEdit);
      box.querySelector('.invalid-feedback').textContent = p.error || '';
      if (p.error) { bad = true; return; }
      if (p.skip) return;
      if (isEdit) {

        var orig = editing[c.column_name];
        var same = JSON.stringify(orig === undefined ? null : orig) === JSON.stringify(p.value);
        if (same || (el.value === strVal(orig))) return;
      }
      payload[c.column_name] = p.value;
    });
    if (bad) return;
    if (isEdit && !Object.keys(payload).length) { window.jQuery('#row-modal').modal('hide'); return; }

    var btn = $('modal-save'), label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...';
    try {
      var r = isEdit
        ? await sb.from(table).update(payload).eq('id', editing.id).select(colList())
        : await sb.from(table).insert(payload).select(colList());
      if (r.error) throw r.error;
      if (isEdit && !r.data.length) throw new Error('No row was updated.');
      await REMS.log((isEdit ? 'Modified id=' + editing.id + ' in ' : 'Inserted row in ') + table);
      window.jQuery('#row-modal').modal('hide');
      flash('success', isEdit ? 'Row saved.' : 'Row added.');
      await load();
    } catch (err) {
      console.error(err);
      flash('danger', 'Save failed: ' + (err.message || 'unknown error'), 'modal-msg');
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });

  await load();
})();
