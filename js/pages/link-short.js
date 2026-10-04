(async function () {
  'use strict';
  document.title = 'Short links: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'link.manage' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 20, page = 0;
  var SLUG_RE = /^[A-Za-z0-9_-]{3,40}$/;
  var ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var RESERVED = ['admin', 'api', 'login', 'assets', 'js'];
  var base = new URL('s/', location.href).href;
  $('s-prefix').textContent = base.replace(/^https?:\/\//, '');

  function flash(kind, html) {
    if (REMS.toastIfShort(kind, html)) { $('msg').innerHTML = ''; return; }
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }
  function shortOf(slug) { return base + slug; }
  function randomSlug() {
    var bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ALPHABET[b % ALPHABET.length]; }).join('');
  }
  function cleanUrl(v) {
    v = String(v || '').trim();
    try { var u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; }
  }

  $('short-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = cleanUrl($('s-url').value);
    var slug = $('s-slug').value.trim();
    if (!url) return flash('warning', 'Enter a full link that starts with https:// (or http://).');
    if (url.length > 2000) return flash('warning', 'That link is too long (limit 2000 characters).');
    if (url.indexOf(base) === 0) return flash('warning', 'That is already one of your short links.');
    if (slug && !SLUG_RE.test(slug)) return flash('warning', 'The short name must be 3 to 40 letters, digits, - or _.');
    var custom = !!slug;
    if (custom && RESERVED.indexOf(slug.toLowerCase()) > -1) return flash('warning', 'Please choose a different short name.');
    $('s-btn').disabled = true;
    try {
      var row = null;
      for (var tries = 0; tries < 5 && !row; tries++) {
        var candidate = custom ? slug : randomSlug();
        var r = await sb.from('short_links').insert({ club_id: REMS.clubId(), slug: candidate, url: url, created_by: REMS.profile.login_name }).select('slug').single();
        if (!r.error) { row = r.data; break; }
        if (r.error.code === '23505') {
          if (custom) { flash('warning', 'The name <strong>' + esc(slug) + '</strong> is already taken. Try another.'); return; }
          continue;
        }
        throw r.error;
      }
      if (!row) throw new Error('Could not find a free random name. Try again.');
      await REMS.log('Short link ' + shortOf(row.slug) + ' -> ' + url.slice(0, 120));
      $('s-out').value = shortOf(row.slug);
      $('s-result').style.display = '';
      $('s-url').value = ''; $('s-slug').value = '';
      page = 0; loadLinks();
    } catch (err) {
      flash('danger', 'Could not save the link: ' + esc(err.message || err));
    } finally { $('s-btn').disabled = false; }
  });

  function copy(text, btn) {
    function ok() { if (btn) { var h = btn.innerHTML; btn.innerHTML = '<i class="fas fa-check"></i> Copied'; setTimeout(function () { btn.innerHTML = h; }, 1500); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    else fallback();
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); ok(); } catch (e) {} t.remove();
    }
  }
  $('s-copy').addEventListener('click', function () { copy($('s-out').value, this); });

  var rows = [];
  async function loadLinks() {
    var r = await sb.from('short_links').select('id,slug,url,clicks,created_by,created_at', { count: 'exact' }).eq('club_id', REMS.clubId())
      .order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (r.error) { $('links-body').innerHTML = '<tr><td colspan="5" class="text-danger">' + esc(r.error.message) + '</td></tr>'; return; }
    rows = r.data;
    $('links-body').innerHTML = rows.length ? rows.map(function (l, i) {
      var shown = l.url.length > 70 ? l.url.slice(0, 67) + '...' : l.url;
      return '<tr><td class="text-nowrap"><a href="' + esc(shortOf(l.slug)) + '" target="_blank" rel="noopener">/s/' + esc(l.slug) + '</a></td>' +
        '<td><span title="' + esc(l.url) + '">' + esc(shown) + '</span></td><td class="text-center">' + l.clicks + '</td><td>' + esc(l.created_by || '') + '</td>' +
        '<td class="text-right text-nowrap"><button class="btn btn-sm btn-outline-primary mr-1 act-copy" data-i="' + i + '"><i class="far fa-copy"></i></button>' +
        '<button class="btn btn-sm btn-outline-danger act-del" data-i="' + i + '"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-muted">No short links yet.</td></tr>';
    var total = r.count || 0, last = Math.max(0, Math.ceil(total / PAGE) - 1);
    $('links-info').textContent = total ? 'Showing ' + (page * PAGE + 1) + '-' + (page * PAGE + rows.length) + ' of ' + total : '';
    $('links-prev').disabled = page <= 0; $('links-next').disabled = page >= last;
  }
  $('links-prev').addEventListener('click', function () { page = Math.max(0, page - 1); loadLinks(); });
  $('links-next').addEventListener('click', function () { page++; loadLinks(); });

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || b.dataset.i === undefined) return;
    var l = rows[Number(b.dataset.i)]; if (!l) return;
    if (b.classList.contains('act-copy')) return copy(shortOf(l.slug), b);
    if (b.classList.contains('act-del')) {
      if (!await REMS.confirm('Delete the short link /s/' + l.slug + '? Anyone who has it will get an error.', { title: 'Delete short link', ok: 'Delete', danger: true })) return;
      var d = await sb.from('short_links').delete().eq('id', l.id);
      if (d.error) return flash('danger', esc(d.error.message));
      await REMS.log('Deleted short link /s/' + l.slug);
      loadLinks();
    }
  });

  await loadLinks();
})();
