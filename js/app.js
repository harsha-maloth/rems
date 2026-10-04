/* ClubOrbit shared front-end runtime: Supabase client, auth guard, layout injection. */
(function () {
  'use strict';

  var cfg = window.REMS_CONFIG;
  var REMEMBER_KEY = 'rems.remember';
  var CLUB_KEY = 'orbit.club';          // id of the club the person last worked in

  // Session storage follows "Remember me": localStorage if ticked, otherwise per-tab.
  var storage = {
    getItem: function (k) {
      var v = localStorage.getItem(k);
      return v !== null ? v : sessionStorage.getItem(k);
    },
    setItem: function (k, v) {
      (localStorage.getItem(REMEMBER_KEY) === '1' ? localStorage : sessionStorage).setItem(k, v);
    },
    removeItem: function (k) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
  };

  var configured = cfg && cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1;
  var sb = null;
  if (window.supabase && configured) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { storage: storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Only allow same-folder .html targets, never absolute URLs (open-redirect guard).
  function safeNext(value) {
    return /^[A-Za-z0-9_\-]+\.html(\?[A-Za-z0-9_=&%\-.]*)?$/.test(value || '') ? value : 'dashboard.html';
  }

  var REMS = {
    cfg: cfg,
    sb: sb,
    esc: esc,
    safeNext: safeNext,
    profile: null,
    clubs: [],            // clubs the person belongs to: { id, slug, name, status, titles[], perms[] }
    club: null,           // the selected club (what every page works on)
    univ: false,          // true for university admins (may import and read the student list)
    DEFAULT_AVATAR: 'assets/img/avatars/image2.png',

    configured: function () { return !!sb; },

    setRemember: function (on) {
      if (on) localStorage.setItem(REMEMBER_KEY, '1'); else localStorage.removeItem(REMEMBER_KEY);
    },

    showConfigError: function () {
      var box = document.createElement('div');
      box.className = 'alert alert-warning m-3';
      box.innerHTML = '<strong>Supabase is not configured.</strong> Edit <code>js/config.js</code> with your project URL and anon key.';
      document.body.insertBefore(box, document.body.firstChild);
    },

    /** True when the selected club grants this permission (same answer the database gives). */
    can: function (perm) { return !!REMS.club && REMS.club.perms.indexOf(perm) !== -1; },

    /** True when the person holds at least one current position in the selected club (wing leads included). */
    holder: function () { return !!REMS.club && REMS.club.titles.length > 0; },

    /**
     * Styled replacement for window.confirm. Resolves true (OK) or false (Cancel, Esc, click outside).
     * The message is plain text (line breaks kept), so names typed by users can never inject HTML.
     * opts: { title, ok (button label), danger (red button, Cancel focused first) }
     */
    confirm: function (message, opts) {
      opts = opts || {};
      var $j = window.jQuery;
      if (!$j || !$j.fn || !$j.fn.modal) return Promise.resolve(window.confirm(message));
      return new Promise(function (resolve) {
        var old = document.getElementById('orbit-confirm');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<div class="modal fade orbit-confirm" id="orbit-confirm" tabindex="-1" role="alertdialog" aria-modal="true" aria-labelledby="orbit-confirm-title" aria-describedby="orbit-confirm-body">' +
          '<div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title" id="orbit-confirm-title"></h5></div>' +
          '<div class="modal-body" id="orbit-confirm-body"></div>' +
          '<div class="modal-footer"><button type="button" class="btn btn-light" id="orbit-confirm-cancel">Cancel</button>' +
          '<button type="button" class="btn" id="orbit-confirm-ok"></button></div>' +
          '</div></div></div>';
        var el = wrap.firstChild;
        document.body.appendChild(el);
        el.querySelector('#orbit-confirm-title').textContent = opts.title || 'Are you sure?';
        el.querySelector('#orbit-confirm-body').textContent = message;
        var ok = el.querySelector('#orbit-confirm-ok');
        ok.textContent = opts.ok || 'OK';
        ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
        var answer = false;
        ok.addEventListener('click', function () { answer = true; $j(el).modal('hide'); });
        el.querySelector('#orbit-confirm-cancel').addEventListener('click', function () { $j(el).modal('hide'); });
        $j(el).on('shown.bs.modal', function () { (opts.danger ? el.querySelector('#orbit-confirm-cancel') : ok).focus(); });
        $j(el).on('hidden.bs.modal', function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          resolve(answer);
        });
        $j(el).modal('show');
      });
    },

    /** Small message in the corner that fades by itself. kind: success | info | warning | danger. Plain text only. */
    toast: function (kind, text) {
      var box = document.getElementById('orbit-toasts');
      if (!box) {
        box = document.createElement('div');
        box.id = 'orbit-toasts';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        document.body.appendChild(box);
      }
      var t = document.createElement('div');
      t.className = 'orbit-toast orbit-toast-' + (kind || 'info');
      var icon = { success: 'fa-check-circle', warning: 'fa-exclamation-triangle', danger: 'fa-times-circle' }[kind] || 'fa-info-circle';
      t.innerHTML = '<i class="fas ' + icon + ' mr-2"></i><span></span>';
      t.querySelector('span').textContent = text;
      box.appendChild(t);
      setTimeout(function () { t.classList.add('orbit-toast-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 400); }, 4000);
    },

    /**
     * For a page's flash(): short, link-free success messages become a toast (no jump to the top of the page).
     * Returns true when it handled the message; the page then skips its inline alert.
     */
    toastIfShort: function (kind, html) {
      if (kind !== 'success') return false;
      var s = String(html == null ? '' : html);
      if (/<a[\s>]|<br|<ul|<li|<code/i.test(s)) return false;
      var text = (new DOMParser().parseFromString(s, 'text/html').body.textContent || '').trim();
      if (!text || text.length > 120) return false;
      REMS.toast('success', text);
      return true;
    },

    /** Id of the selected club, for the club_id column of anything a page creates. */
    clubId: function () { return REMS.club ? REMS.club.id : null; },

    /** Remember the choice and reload so the page works on the new club. */
    selectClub: function (id) {
      try { localStorage.setItem(CLUB_KEY, String(id)); } catch (e) {}
      location.reload();
    },

    /** Load the person's clubs and pick the selected one (saved choice, else the first). */
    loadClubs: async function () {
      REMS.clubs = []; REMS.club = null;
      var r = await sb.rpc('my_clubs');
      if (r.error) { console.warn('my_clubs failed - is migration 0005 applied?', r.error); return; }
      REMS.clubs = (r.data || []).map(function (c) {
        return { id: c.club_id, slug: c.club_slug, name: c.club_name, status: c.club_status, titles: c.titles || [], perms: c.perms || [] };
      });
      var saved = null;
      try { saved = localStorage.getItem(CLUB_KEY); } catch (e) {}
      REMS.club = REMS.clubs.filter(function (c) { return String(c.id) === saved; })[0] || REMS.clubs[0] || null;
    },

    /** Append a row to the activity log (best effort). */
    log: async function (message) {
      try {
        var name = REMS.profile && REMS.profile.login_name;
        if (!name) return;
        await sb.from('logging').insert({ userid: name, log: message });
      } catch (e) { console.warn('log failed', e); }
    },

    /**
     * Redirect away unless signed in. Options:
     *   perm:  permission the selected club must grant (e.g. 'mail.send')
     *   admin: platform admin only (profiles.is_admin)
     *   univ:  university admin only (university_admins table)
     *   holder: holds any current position in the selected club
     * Resolves with the profile; REMS.club / REMS.clubs are loaded by then.
     */
    requireAuth: async function (opts) {
      opts = opts || {};
      if (!sb) { REMS.showConfigError(); throw new Error('not configured'); }
      var res = await sb.auth.getSession();
      if (!res.data.session) {
        location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
        throw new Error('redirecting');
      }
      var p = await sb.from('profiles').select('*').eq('id', res.data.session.user.id).maybeSingle();
      if (p.error || !p.data) {
        await sb.auth.signOut();
        location.replace('login.html');
        throw new Error('no profile');
      }
      REMS.profile = p.data;
      await REMS.loadClubs();
      REMS.univ = false;
      try { var u = await sb.rpc('is_university_admin'); REMS.univ = !u.error && u.data === true; } catch (e) {}
      if ((opts.admin && !p.data.is_admin) || (opts.perm && !REMS.can(opts.perm)) || (opts.univ && !REMS.univ) || (opts.holder && !REMS.holder())) {
        location.replace('bad-request.html');
        throw new Error('forbidden');
      }
      return p.data;
    },

    logout: async function () {
      try { await sb.auth.signOut(); } catch (e) {}
      REMS.setRemember(false);
      location.replace('login.html');
    },

    /** Inject sidebar, top bar and footer into the placeholders on a members page. */
    mountLayout: async function () {
      var p = REMS.profile || {};
      var alerts = [];
      try {
        if (REMS.club) {
          var a = await sb.rpc('recent_alerts', { max_rows: 5, p_club: REMS.club.id });
          if (!a.error && a.data) alerts = a.data;
        }
      } catch (e) {}

      var side = document.getElementById('rems-sidebar');
      var top = document.getElementById('rems-topbar');
      var foot = document.getElementById('rems-footer');
      if (side) side.outerHTML = sidebarHtml();
      if (top) top.outerHTML = topbarHtml(p, alerts);
      if (foot) foot.outerHTML = footerHtml();
      applyNavPermissions();

      var picker = document.getElementById('club-switcher');
      if (picker) picker.addEventListener('click', function (e) {
        var a = e.target.closest('a[data-club]');
        if (!a) return;
        e.preventDefault();
        REMS.selectClub(a.getAttribute('data-club'));
      });

      if (window.change_mode) {
        change_mode(localStorage.getItem('rems.theme') === 'dark' ? 'dark' : 'light');
      }
      var nav = document.getElementById('navbar');
      if (nav && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) nav.classList.add('toggled');

      var out = document.getElementById('rems-logout');
      if (out) out.addEventListener('click', function (e) { e.preventDefault(); REMS.logout(); });
    }
  };

  // ---- templates (ported from templates/partials/navigation.html and footer.html) ----

  function sidebarHtml() {
    return '' +
'<nav id="navbar" class="navbar navbar-dark align-items-start sidebar sidebar-dark accordion bg-gradient-primary p-0">' +
'  <div class="container-fluid d-flex flex-column p-0">' +
'    <a class="navbar-brand d-flex justify-content-center align-items-center sidebar-brand m-0" href="dashboard.html">' +
'      <div class="sidebar-brand-icon"><img loading="lazy" class="logo" src="assets/img/Logo_Banner_White.png" alt="Logo"></div>' +
'      <div class="sidebar-brand-text mx-3"></div>' +
'    </a>' +
'    <hr class="sidebar-divider my-0">' +
'    <ul class="nav navbar-nav text-light" id="accordionSidebar">' +
'      <div class="sidebar-heading"><p class="mb-0">Home</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" href="dashboard.html"><i class="fas fa-tachometer-alt"></i><span>&nbsp;Club dashboard</span></a></li>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" href="student.html"><i class="fas fa-user-graduate"></i><span>&nbsp;My student portal</span></a></li>' +
'      <hr class="sidebar-divider">' +
'      <div class="sidebar-heading"><p class="mb-0">My club</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-holder="1" href="club.html"><i class="fas fa-sitemap"></i><span>&nbsp;Members &amp; positions</span></a></li>' +
'      <hr class="sidebar-divider">' +
'      <div class="sidebar-heading"><p class="mb-0">Events &amp; forms</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="form.manage" href="forms-generator.html"><i class="fab fa-wpforms"></i><span>&nbsp;Event forms</span></a></li>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="form.manage" href="forms-registrations.html"><i class="fas fa-eye"></i><span>&nbsp;Registrations</span></a></li>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="certificate.issue" href="cert-generate.html"><i class="fas fa-medal"></i><span>&nbsp;Issue certificates</span></a></li>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="link.manage" href="link-short.html"><i class="fas fa-link"></i><span>&nbsp;Short links</span></a></li>' +
'      <hr class="sidebar-divider">' +
'      <div class="sidebar-heading"><p class="mb-0">Communicate</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="mail.send" href="mailing-list.html"><i class="fas fa-list"></i><span>&nbsp;Contact lists</span></a></li>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-perm="mail.send" href="mailing-bulk.html"><i class="fas fa-mail-bulk"></i><span>&nbsp;Send email</span></a></li>' +
'      <hr class="sidebar-divider">' +
'      <div class="sidebar-heading"><p class="mb-0">University</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-univ="1" href="university-students.html"><i class="fas fa-id-card"></i><span>&nbsp;Student list</span></a></li>' +
'      <hr class="sidebar-divider">' +
'      <div class="sidebar-heading"><p class="mb-0">Admin</p></div>' +
'      <li class="nav-item" role="presentation"><a class="nav-link" data-platform="1" href="db-manage.html"><i class="fas fa-database"></i><span>&nbsp;Platform tools</span></a></li>' +
'      <hr class="sidebar-divider">' +
'    </ul>' +
'    <div class="text-center d-none d-md-inline"><button class="btn rounded-circle border-0" id="sidebarToggle" type="button"></button></div>' +
'  </div>' +
'</nav>';
  }

  function alertItem(a) {
    var meta = '<p class="small text-gray-500 mb-0">' + esc(a.username) + ' - ' + esc(new Date(a.timestamp).toLocaleString()) + '</p>';
    var body = '<div class="font-weight-bold"><div class="text-truncate"><span>' + esc(a.message) + '</span></div>' + meta + '</div>';
    var href = /^(https?:\/\/|[A-Za-z0-9_\-]+\.html|#)/.test(a.click_url || '') ? a.click_url : '#';
    if (a.imgsrc && String(a.imgsrc).indexOf('data:image/') === 0) {
      return '<a class="d-flex align-items-center dropdown-item" href="' + esc(href) + '">' +
        '<div class="dropdown-list-image mr-3"><img loading="lazy" class="rounded-circle" src="' + esc(a.imgsrc) + '" alt="User avatar" width="32" height="32"><div class="bg-success"></div></div>' +
        body + '</a>';
    }
    var icon = 'fas fa-file-alt', bg = 'bg-primary';
    if (a.type === 'success') { icon = 'fas fa-crosshairs'; bg = 'bg-success'; }
    else if (a.type === 'info') { icon = 'fas fa-info-circle'; bg = 'bg-success'; }
    else if (a.type === 'warning') { icon = 'fas fa-exclamation-triangle'; bg = 'bg-warning'; }
    return '<a class="d-flex align-items-center dropdown-item" href="' + esc(href) + '">' +
      '<div class="mr-3"><div class="' + bg + ' icon-circle"><i class="' + icon + ' text-white"></i></div></div>' +
      body + '</a>';
  }

  /** " - President" next to the club name (hidden on phones). Plain members show "Member". */
  function positionLabel(c) {
    var t = c.titles && c.titles.length ? c.titles.join(', ') : 'Member';
    return ' <small class="d-none d-sm-inline ml-1" style="opacity:.85">&middot; ' + esc(t) + '</small>';
  }

  /** Club name in the top bar; a dropdown when the person belongs to more than one club. */
  function clubSwitcherHtml() {
    if (!REMS.clubs.length) {
      return '<span class="badge badge-secondary mr-2" id="club-switcher">No club yet</span>';
    }
    var cur = REMS.club;
    if (REMS.clubs.length === 1) {
      return '<span class="badge badge-primary mr-2 p-2" id="club-switcher" title="' + esc(cur.titles.join(', ')) + '"><i class="fas fa-users mr-1"></i>' + esc(cur.name) + positionLabel(cur) + '</span>';
    }
    var items = REMS.clubs.map(function (c) {
      return '<a class="dropdown-item' + (c.id === cur.id ? ' active' : '') + '" href="#" data-club="' + esc(c.id) + '">' + esc(c.name) +
        (c.titles.length ? ' <small class="text-muted">' + esc(c.titles.join(', ')) + '</small>' : '') + '</a>';
    }).join('');
    return '<div class="dropdown mr-2" id="club-switcher">' +
      '<a class="btn btn-primary btn-sm dropdown-toggle" href="#" data-toggle="dropdown" aria-expanded="false" aria-label="Switch club"><i class="fas fa-users mr-1"></i>' + esc(cur.name) + positionLabel(cur) + '</a>' +
      '<div class="dropdown-menu">' + items + '</div></div>';
  }

  /** Hide menu entries the selected club does not grant, and headings left with nothing under them. */
  function applyNavPermissions() {
    var nav = document.getElementById('accordionSidebar');
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-perm]'), function (a) {
      if (!REMS.can(a.getAttribute('data-perm'))) a.style.display = 'none';
    });
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-holder]'), function (a) {
      if (!REMS.holder()) a.style.display = 'none';
    });
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-univ]'), function (a) {
      if (!REMS.univ) a.style.display = 'none';
    });
    var platform = !!(REMS.profile && REMS.profile.is_admin);
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-platform]'), function (a) {
      if (!platform) a.style.display = 'none';
    });
    var heading = null, group = [];
    function flush() {
      if (!heading) return;
      var any = group.some(function (el) {
        return Array.prototype.some.call(el.querySelectorAll('a.nav-link'), function (a) { return a.style.display !== 'none'; });
      });
      if (!any) { heading.style.display = 'none'; group.forEach(function (el) { el.style.display = 'none'; }); }
    }
    Array.prototype.forEach.call(nav.children, function (el) {
      if (el.classList.contains('sidebar-heading')) { flush(); heading = el; group = []; }
      else if (el.tagName === 'LI' && heading) group.push(el);
    });
    flush();
  }

  /** "Report a problem" lives in the profile menu (was a red button on the dashboard). */
  function reportLinkHtml() {
    if (!cfg.REPO_URL) return '';
    return '<a class="dropdown-item" role="presentation" target="_blank" rel="noopener noreferrer" href="' + esc(String(cfg.REPO_URL).replace(/\/$/, '') + '/issues') + '"><i class="fas fa-bug fa-sm fa-fw mr-2 text-gray-400"></i>&nbsp;Report a problem</a>';
  }

  function topbarHtml(p, alerts) {
    var pic = p.imgsrc && String(p.imgsrc).indexOf('data:image/') === 0 ? p.imgsrc : REMS.DEFAULT_AVATAR;
    var badge = alerts.length ? '<span class="badge badge-danger badge-counter">' + alerts.length + '</span>' : '';
    var alertList = alerts.length
      ? alerts.map(alertItem).join('')
      : '<span class="text-center dropdown-item small text-gray-500">No new alerts</span>';
    return '' +
'<nav class="navbar navbar-light navbar-expand bg-white shadow mb-4 topbar static-top">' +
'  <div class="container-fluid">' +
'    <button class="btn btn-link d-md-none rounded-circle mr-3" id="sidebarToggleTop" type="button"><i class="fas fa-bars"></i></button>' +
clubSwitcherHtml() +
'    <div class="mr-auto"></div>' +
'    <ul class="nav navbar-nav flex-nowrap ml-auto">' +
'      <li class="nav-item dropdown no-arrow mx-1" role="presentation">' +
'        <div class="toggle" id="mode_toggler">' +
'          <span class="icon sun"><i class="fas fa-sun"></i></span>' +
'          <input type="checkbox" id="toggle-switch" />' +
'          <label for="toggle-switch"><span class="screen-reader-text">Toggle Color Scheme</span></label>' +
'          <span class="icon moon"><i class="fas fa-moon"></i></span>' +
'        </div>' +
'      </li>' +
'      <li class="nav-item dropdown no-arrow mx-1" role="presentation">' +
'        <div class="nav-item dropdown no-arrow">' +
'          <a class="dropdown-toggle nav-link" data-toggle="dropdown" aria-expanded="false" href="#">' + badge + '<i class="fas fa-bell fa-fw"></i></a>' +
'          <div class="dropdown-menu dropdown-menu-right dropdown-list dropdown-menu-right animated--grow-in" role="menu">' +
'            <h6 class="dropdown-header">alerts center</h6>' + alertList +
'          </div>' +
'        </div>' +
'      </li>' +
'      <div class="d-none d-sm-block topbar-divider"></div>' +
'      <li class="nav-item dropdown no-arrow" role="presentation">' +
'        <div class="nav-item dropdown no-arrow">' +
'          <a class="dropdown-toggle nav-link" data-toggle="dropdown" aria-expanded="false" href="#">' +
'            <span class="d-none d-lg-inline mr-2 text-gray-600 small">' + esc(p.login_name) + '</span>' +
'            <img loading="lazy" class="border rounded-circle img-profile" src="' + esc(pic) + '" alt="Profile" width="32" height="32"></a>' +
'          <div class="dropdown-menu shadow dropdown-menu-right animated--grow-in" role="menu">' +
'            <a class="dropdown-item" role="presentation" href="profile.html"><i class="fas fa-user fa-sm fa-fw mr-2 text-gray-400"></i>&nbsp;Profile</a>' +
'            <a class="dropdown-item" role="presentation" href="logs.html"><i class="fas fa-list fa-sm fa-fw mr-2 text-gray-400"></i>&nbsp;Activity log</a>' +
reportLinkHtml() +
'            <div class="dropdown-divider"></div>' +
'            <a class="dropdown-item" role="presentation" id="rems-logout" href="#"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>&nbsp;Logout</a>' +
'          </div>' +
'        </div>' +
'      </li>' +
'    </ul>' +
'  </div>' +
'</nav>';
  }

  function footerHtml() {
    return '' +
'<footer class="bg-white sticky-footer">' +
'  <div class="container my-auto"><div class="text-center">' +
'    <strong>ClubOrbit</strong> by IIST-OSS' +
'    <br><small>Version ' + esc(cfg.APP_VERSION) + ' &mdash; <a href="' + esc(cfg.REPO_URL) + '">View on GitHub</a></small>' +
'  </div></div>' +
'</footer>';
  }

  window.REMS = REMS;
})();
