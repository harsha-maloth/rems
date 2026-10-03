/* Activity log: your own entries, newest first. Admins can switch to everyone's. */
(async function () {
  'use strict';
  document.title = 'Activity Log: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var profile;
  try { profile = await REMS.requireAuth(); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var perPage = [10, 25, 50, 100].indexOf(parseInt(params.get('perPage'), 10)) > -1 ? parseInt(params.get('perPage'), 10) : 10;
  var page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  var scope = profile.is_admin && params.get('scope') === 'all' ? 'all' : 'mine';

  $('per-page').value = perPage;
  if (profile.is_admin) { $('scope-wrap').style.display = ''; $('scope').value = scope; }

  function url(p) {
    var q = new URLSearchParams();
    if (perPage !== 10) q.set('perPage', perPage);
    if (scope === 'all') q.set('scope', 'all');
    q.set('page', p);
    return 'logs.html?' + q.toString();
  }
  function go(over) {
    if (over.perPage) { perPage = over.perPage; page = 1; }
    if (over.scope) { scope = over.scope; page = 1; }
    location.href = url(page);
  }
  $('per-page').addEventListener('change', function () { go({ perPage: parseInt(this.value, 10) }); });
  $('scope').addEventListener('change', function () { go({ scope: this.value }); });

  function pager(total) {
    var pages = Math.ceil(total / perPage);
    if (pages <= 1) return '';
    var h = '<nav aria-label="Log pages"><ul class="pagination justify-content-md-end flex-wrap mb-0">';
    h += '<li class="page-item' + (page <= 1 ? ' disabled' : '') + '"><a class="page-link" href="' + esc(url(page - 1)) + '" aria-label="Previous">&laquo;</a></li>';
    var last = 0;
    for (var i = 1; i <= pages; i++) {
      if (i !== 1 && i !== pages && Math.abs(i - page) > 2) continue;
      if (i - last > 1) h += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
      h += i === page
        ? '<li class="page-item active"><span class="page-link">' + i + '</span></li>'
        : '<li class="page-item"><a class="page-link" href="' + esc(url(i)) + '">' + i + '</a></li>';
      last = i;
    }
    h += '<li class="page-item' + (page >= pages ? ' disabled' : '') + '"><a class="page-link" href="' + esc(url(page + 1)) + '" aria-label="Next">&raquo;</a></li>';
    return h + '</ul></nav>';
  }

  function fmt(ts) {
    var d = new Date(ts);
    return isNaN(d) ? esc(ts) : esc(d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  $('card-title').textContent = scope === 'all' ? 'Activity of all members' : 'Your activity';
  $('log-head').innerHTML = (scope === 'all' ? '<th class="table-info">User</th>' : '') +
    '<th class="table-info">Timestamp</th><th class="table-info">Log</th>';
  var cols = scope === 'all' ? 3 : 2;

  try {
    var r;
    for (var attempt = 0; attempt < 2; attempt++) {
      var from = (page - 1) * perPage;
      var q = sb.from('logging').select('id,timestamp,userid,log', { count: 'exact' });
      if (scope === 'mine') q = q.eq('userid', profile.login_name);
      r = await q.order('id', { ascending: false }).range(from, from + perPage - 1);
      if (r.error && r.error.code === 'PGRST103' && page > 1) { page = 1; continue; }  // past the last page
      break;
    }
    if (r.error) throw r.error;
    var total = r.count || 0;
    if (!r.data.length) {
      $('log-body').innerHTML = '<tr><td colspan="' + cols + '" class="text-center text-muted py-4">No activity recorded yet.</td></tr>';
      $('info').textContent = '';
      return;
    }
    $('log-body').innerHTML = r.data.map(function (l) {
      return '<tr>' + (scope === 'all' ? '<td>' + esc(l.userid) + '</td>' : '') +
        '<td class="text-nowrap">' + fmt(l.timestamp) + '</td><td>' + esc(l.log) + '</td></tr>';
    }).join('');
    var start = (page - 1) * perPage + 1;
    $('info').textContent = 'Showing ' + start + ' to ' + (start + r.data.length - 1) + ' of ' + total + ' entries';
    $('pager').innerHTML = pager(total);
  } catch (err) {
    console.error(err);
    $('msg').innerHTML = '<div class="alert alert-danger">Could not load the activity log. Please refresh and try again.</div>';
    $('log-body').innerHTML = '';
  }
})();
