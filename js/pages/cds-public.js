(function () {
  'use strict';
  var esc = REMS.esc;
  var content = document.getElementById('content');
  var titleEl = document.getElementById('page-title');

  function fail(text) {
    content.innerHTML = '<div class="alert alert-danger" role="alert"><i class="fas fa-exclamation-triangle mr-2"></i>' + esc(text) + '</div>';
  }
  if (!REMS.configured()) { REMS.showConfigError(); fail('The site is not configured yet.'); return; }

  var sb = REMS.sb;
  var params = new URLSearchParams(location.search);
  var listMode = params.has('mode');
  var eventParam = (params.get('event') || '').trim();
  var search = (params.get('search') || '').trim().slice(0, 100);
  var perPage = Math.min(50, Math.max(5, parseInt(params.get('perPage'), 10) || 10));
  var page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  var eventName = '';
  var DEFAULT_PER_PAGE = 10;

  function escLike(s) { return s.replace(/[\\%_]/g, function (c) { return '\\' + c; }); }
  function title(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/(^|[\s-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function upper(s) { return String(s == null ? '' : s).toUpperCase(); }
  function fmtDate(d) {
    if (!d) return 'N/A';
    var dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? esc(d) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function safeLink(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }

  function pageUrl(p) {
    var q = new URLSearchParams();
    if (listMode) q.set('mode', '1');
    else { q.set('event', eventName); if (search) q.set('search', search); }
    if (perPage !== DEFAULT_PER_PAGE) q.set('perPage', perPage);
    q.set('page', p);
    return 'cds-public.html?' + q.toString();
  }

  function pagination(total) {
    var pages = Math.ceil(total / perPage);
    if (pages <= 1) return '';
    var h = '<nav aria-label="Results pagination"><ul class="pagination justify-content-center flex-wrap">';
    h += '<li class="page-item' + (page <= 1 ? ' disabled' : '') + '"><a class="page-link" href="' + esc(pageUrl(page - 1)) + '"><i class="fas fa-chevron-left"></i></a></li>';
    var last = 0;
    for (var i = 1; i <= pages; i++) {
      if (i !== 1 && i !== pages && Math.abs(i - page) > 2) continue;
      if (i - last > 1) h += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
      h += i === page
        ? '<li class="page-item active"><span class="page-link">' + i + '</span></li>'
        : '<li class="page-item"><a class="page-link" href="' + esc(pageUrl(i)) + '">' + i + '</a></li>';
      last = i;
    }
    h += '<li class="page-item' + (page >= pages ? ' disabled' : '') + '"><a class="page-link" href="' + esc(pageUrl(page + 1)) + '"><i class="fas fa-chevron-right"></i></a></li>';
    return h + '</ul></nav>';
  }

  async function load(table, cols, shape) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var from = (page - 1) * perPage;
      var r = await shape(sb.from(table).select(cols, { count: 'exact' })).range(from, from + perPage - 1);
      if (r.error && r.error.code === 'PGRST103' && page > 1) { page = 1; continue; }
      return r;
    }
  }

  async function runList() {
    titleEl.textContent = 'Events Details';
    document.title = 'Events: ' + ((REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME) || 'CDS');
    var r = await load('events', 'event_name,date,is_inter', function (q) {
      return q.order('date', { ascending: false }).order('event_name');
    });
    if (r.error) throw r.error;
    var total = r.count || 0;
    if (!r.data.length) {
      content.innerHTML = '<div class="text-center py-4"><div class="alert alert-info" role="alert">' +
        '<i class="fas fa-calendar-times fa-2x mb-3"></i><h5 class="alert-heading">No Events Found</h5>' +
        '<p class="mb-0">No events have been conducted yet. Check back later!</p></div></div>';
      return;
    }
    var rows = r.data.map(function (ev) {
      return '<tr><td class="font-weight-bold"><a href="cds-public.html?event=' + encodeURIComponent(ev.event_name) + '">' +
        esc(title(ev.event_name)) + '</a></td><td>' + fmtDate(ev.date) + '</td></tr>';
    }).join('');
    content.innerHTML =
      '<div class="text-right mb-2"><small class="text-muted">' + total + ' event' + (total === 1 ? '' : 's') + '</small></div>' +
      '<div class="table-responsive"><table class="table table-hover table-sm"><thead class="thead-light"><tr>' +
      '<th><i class="fas fa-calendar-alt mr-1"></i>Event Name</th><th><i class="fas fa-clock mr-1"></i>Date</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' + pagination(total);
  }

  function certRow(c, isInter) {
    var pos = c.position ? '<span class="badge badge-success">' + esc(title(c.position)) + '</span>' : '';
    var yr = c.year != null ? '<span class="badge badge-info">' + esc(c.year) + '</span>' : '';
    var dl = '<a href="' + esc(safeLink(c.cert_link)) + '" class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener">' +
      '<i class="fas fa-download mr-1"></i>Download</a>';
    var h = '<tr><td class="font-weight-bold">' + esc(title(c.name)) + '</td>';
    if (isInter) {
      h += '<td>' + esc(title(c.college)) + '</td><td>' + yr + '</td><td>' + pos + '</td><td>' + dl + '</td>';
    } else {
      h += '<td>' + esc(c.regno) + '</td><td>' + esc(upper(c.dept)) + '</td><td>' + yr + '</td><td>' +
        esc(upper(c.section)) + '</td><td>' + pos + '</td><td>' + dl + '</td>';
    }
    return h + '</tr>';
  }

  async function runCertificates() {
    if (!eventParam) { location.replace('index.html?status=notfound'); return; }

    var ev = await sb.from('events').select('event_name,is_inter').ilike('event_name', escLike(eventParam)).limit(1);
    if (ev.error) throw ev.error;
    if (!ev.data.length) {
      location.replace('index.html?status=notfound&searched_event=' + encodeURIComponent(eventParam.slice(0, 200)));
      return;
    }
    eventName = ev.data[0].event_name;
    var isInter = !!ev.data[0].is_inter;
    titleEl.textContent = title(eventName);
    document.title = title(eventName) + ' - CDS';

    var cols = 'id,name,regno,dept,year,section,position,cert_link,college';
    var r = await load('certificates', cols, function (q) {
      q = q.eq('event_name', eventName);
      if (search) q = q.ilike('name', '%' + escLike(search) + '%');
      return q.order('name').order('id');
    });
    if (r.error) throw r.error;
    var total = r.count || 0;

    if (!total) {
      var clear = 'cds-public.html?event=' + encodeURIComponent(eventName);
      content.innerHTML = '<div class="text-center py-4"><div class="alert alert-warning" role="alert">' +
        '<i class="fas fa-exclamation-triangle fa-2x mb-3"></i><h5 class="alert-heading">No Certificates Found</h5><p class="mb-2">' +
        (search
          ? 'We couldn\'t find any certificates matching your search "' + esc(search) + '" for the event "' + esc(title(eventName)) +
            '".<br><a href="' + esc(clear) + '" class="alert-link">Clear search</a> to see all certificates for this event.'
          : 'Oops! You\'ve found an event with no available certificates yet.<br>If you think this is a mistake, reach out to one of the club members.') +
        '</p></div></div>';
      return;
    }

    var head = isInter
      ? ['fa-user|Name', 'fa-university|College', 'fa-graduation-cap|Year', 'fa-trophy|Position', 'fa-download|Certificate']
      : ['fa-user|Name', 'fa-id-badge|Reg No', 'fa-book|Department', 'fa-graduation-cap|Year', 'fa-users|Section', 'fa-trophy|Position', 'fa-download|Certificate'];
    var th = head.map(function (h) {
      var p = h.split('|');
      return '<th><i class="fas ' + p[0] + ' mr-1"></i>' + p[1] + '</th>';
    }).join('');

    content.innerHTML =
      '<div class="row mb-3"><div class="col-md-6">' +
      '<form method="get" action="cds-public.html"><input type="hidden" name="event" value="' + esc(eventName) + '">' +
      '<input type="hidden" name="page" value="1"><div class="input-group">' +
      '<input type="text" name="search" value="' + esc(search) + '" maxlength="100" class="form-control form-control-sm" placeholder="Search by name...">' +
      '<div class="input-group-append"><button class="btn btn-primary btn-sm" type="submit" aria-label="Search"><i class="fas fa-search"></i></button></div>' +
      '</div></form></div>' +
      '<div class="col-md-6 text-md-right mt-2 mt-md-0"><small class="text-muted">' + total + ' result' + (total === 1 ? '' : 's') + ' found</small></div></div>' +
      '<div class="table-responsive"><table class="table table-hover table-sm"><thead class="thead-light"><tr>' + th + '</tr></thead><tbody>' +
      r.data.map(function (c) { return certRow(c, isInter); }).join('') +
      '</tbody></table></div>' + pagination(total);
  }

  (listMode ? runList() : runCertificates()).catch(function (err) {
    console.error(err);
    titleEl.textContent = 'Something went wrong';
    fail('Could not load the results. Please refresh the page or try again in a moment.');
  });
})();
