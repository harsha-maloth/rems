/* Certificate generator (admin).
 *
 * The original drew certificates on the server with Pillow. Here the browser draws them on a <canvas>,
 * uploads each PNG to the public Supabase Storage bucket `certificates`, and records one row per person
 * in public.certificates (plus the event in public.events). The public CDS pages read those rows.
 *
 * Storage layout:  certificates/<club-id>/<event-slug>/<run-id>/Certificate-<n>.png   (one run folder per generation)
 *                  certificates/<club-id>/_templates/<participation|winner|runner>.<png|jpg|webp>
 * A fresh run folder on every generation means regenerating never serves stale cached images.
 */
(async function () {
  'use strict';
  document.title = 'Issue certificates: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'certificate.issue' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var BUCKET = 'certificates';
  var CLUB = REMS.clubId();
  var ROOT = CLUB + '/';                           // every file of this club lives under <club_id>/
  var store = function () { return sb.storage.from(BUCKET); };

  // ---- layout, in pixels of the reference page (3507 x 2481, A4 landscape at 300 dpi) ----
  // These are the coordinates the original Pillow code used; y is the top of the text line.
  var REF_W = 3507, REF_H = 2481;
  var Y = { presented: 1019, name: 1185, lines: 1317, event: 1439, by: 1559, on: 1672, step: 122 };
  var KINDS = ['participation', 'winner', 'runner'];
  var KIND_LABEL = { participation: 'Participation', winner: 'Winner', runner: 'Runner' };
  var MAX_ROWS = 1000;
  var MAX_TPL_BYTES = 10 * 1024 * 1024;
  var FONT_FAMILY = 'RemsRaleway, Raleway, "Segoe UI", Arial, sans-serif';

  function flash(kind, html) {
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }
  function escLike(s) { return s.replace(/[\\%_]/g, function (c) { return '\\' + c; }); }
  // Same slug rule as the form generator.
  function slugify(name) {
    return String(name).toLowerCase().replace(/[^0-9a-z_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }
  function fmtDate(iso) {            // 2026-03-05 -> 05-03-2026 (no Date object: no time-zone surprises)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  // ======================================================================
  // CSV
  // ======================================================================
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
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

  function clean(v, max) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max || 200) : null;
  }
  // -> { people: [...], errors: [...], warnings: [...] }
  function readPeople(text) {
    var out = { people: [], errors: [], warnings: [] };
    var table = parseCsv(text);
    if (!table.length) { out.errors.push('The file is empty.'); return out; }
    var head = table[0].map(function (h) { return String(h).trim().toLowerCase(); });
    ['name', 'email'].forEach(function (h) { if (head.indexOf(h) === -1) out.errors.push('Missing column "' + h + '". Columns found: ' + head.join(', ')); });
    if (out.errors.length) return out;
    var ix = function (h) { return head.indexOf(h); };
    var noEmail = 0;
    for (var r = 1; r < table.length; r++) {
      var cells = table[r], get = function (h) { var k = ix(h); return k > -1 ? cells[k] : ''; };
      var name = clean(get('name'), 100);
      if (!name) { out.errors.push('Line ' + (r + 1) + ': the name is empty.'); continue; }
      var yr = parseInt(get('year'), 10);
      var email = clean(get('email'), 200);
      if (!email) noEmail++;
      out.people.push({
        name: name,
        regno: clean(get('regno')), dept: clean(get('dept')),
        year: isFinite(yr) ? yr : null,
        section: clean(get('section')),
        email: email || '',
        position: clean(get('position')), college: clean(get('college'))
      });
    }
    if (!out.errors.length && !out.people.length) out.errors.push('The file has a header row but no people.');
    if (out.people.length > MAX_ROWS) { out.errors.push('Too many rows (' + out.people.length + '). Please split the file into batches of at most ' + MAX_ROWS + '.'); }
    if (noEmail) out.warnings.push(noEmail + ' row' + (noEmail === 1 ? ' has' : 's have') + ' no e-mail address.');
    return out;
  }

  // ======================================================================
  // Fonts and canvas drawing
  // ======================================================================
  var fontsReady = null;
  function loadFonts() {
    if (!fontsReady) {
      fontsReady = Promise.all([['300', 'Light'], ['400', 'Regular'], ['500', 'Medium']].map(function (f) {
        var face = new FontFace('RemsRaleway', 'url(assets/fonts/raleway/Raleway-' + f[1] + '.ttf)', { weight: f[0] });
        return face.load().then(function (loaded) { document.fonts.add(loaded); });
      }));
    }
    return fontsReady;
  }

  function setFont(ctx, weight, px) { ctx.font = weight + ' ' + Math.max(1, Math.round(px * 100) / 100) + 'px ' + FONT_FAMILY; }
  // Shrink a single line until it fits maxW (never below minPx).
  function fitPx(ctx, text, weight, startPx, minPx, maxW) {
    var px = startPx;
    setFont(ctx, weight, px);
    while (px > minPx && ctx.measureText(text).width > maxW) { px -= 1; setFont(ctx, weight, px); }
    return px;
  }
  // y is the TOP of the line (what Pillow calls the ascender line); canvas wants the baseline.
  function drawAt(ctx, text, x, yTop, color) {
    var m = ctx.measureText(text || 'x');
    var asc = m.fontBoundingBoxAscent;
    if (!asc) { var px = parseFloat(/([\d.]+)px/.exec(ctx.font)[1]); asc = px * 0.94; }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, x, yTop + asc);
    return yTop + asc;                                   // the baseline that was used
  }
  // Draw on a baseline that was returned by drawAt (keeps a bigger bold word level with the light text before it).
  function drawOnBaseline(ctx, text, x, baseline, color) {
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, x, baseline);
  }
  // Greedy word wrap on measured width; shrinks the font so everything fits in maxLines.
  function wrapToFit(ctx, text, weight, startPx, minPx, maxW, maxLines) {
    var px = startPx, lines;
    for (;;) {
      setFont(ctx, weight, px);
      lines = [];
      var cur = '';
      text.split(/\s+/).forEach(function (w) {
        var tryLine = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(tryLine).width > maxW) { lines.push(cur); cur = w; } else { cur = tryLine; }
      });
      if (cur) lines.push(cur);
      if (lines.length <= maxLines || px <= minPx) break;
      px -= 2;
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return { lines: lines, px: px };
  }

  function positionKind(pos, isInter) {
    if (!isInter) return 'participation';      // the original only used the position templates for inter-college events
    var p = String(pos || '').toLowerCase().replace(/[^a-z]/g, '');
    if (p === 'winner') return 'winner';
    if (p === 'runner' || p === 'runnerup') return 'runner';
    return 'participation';
  }

  // Plain built-in design, used until the admin uploads a template.
  function drawDefaultTemplate(ctx, w, h, kind) {
    var s = w / REF_W, cfg = REMS.cfg || {};
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#14395c'; ctx.lineWidth = 16 * s; ctx.strokeRect(90 * s, 90 * s, w - 180 * s, h - 180 * s);
    ctx.strokeStyle = '#1c8abf'; ctx.lineWidth = 5 * s; ctx.strokeRect(130 * s, 130 * s, w - 260 * s, h - 260 * s);
    var x = 206 * s;
    setFont(ctx, 500, 120 * s); drawAt(ctx, String(cfg.ORG_NAME || ''), x, 260 * s, '#14395c');
    if (cfg.ORG_TAGLINE) { setFont(ctx, 300, 58 * s); drawAt(ctx, String(cfg.ORG_TAGLINE), x, 420 * s, '#535453'); }
    var title = { participation: 'CERTIFICATE OF PARTICIPATION', winner: 'CERTIFICATE OF WINNER', runner: 'CERTIFICATE OF RUNNER-UP' }[kind];
    setFont(ctx, 500, 150 * s);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = (4 * s) + 'px';
    drawAt(ctx, title, x, 700 * s, '#535453');
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  }

  /**
   * Draw one certificate onto `canvas`.
   * tpl: ImageBitmap of the template, or null for the built-in design.
   * meta: { eventName, dateIso, isInter, org }; lay: { x, dy, w, color }
   */
  function renderCertificate(canvas, tpl, person, meta, lay) {
    var w = tpl ? tpl.width : REF_W, h = tpl ? tpl.height : REF_H;
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var kind = positionKind(person.position, meta.isInter);
    if (tpl) ctx.drawImage(tpl, 0, 0, w, h); else drawDefaultTemplate(ctx, w, h, kind);

    var s = w / REF_W, x = lay.x * s, dy = lay.dy * s, maxW = lay.w * s, color = lay.color;
    var yy = function (v) { return (v * 1) * s + dy; };
    var date = fmtDate(meta.dateIso), org = (meta.org || '').trim();

    setFont(ctx, 300, 50 * s);
    drawAt(ctx, 'This certificate is presented to', x, yy(Y.presented), color);

    var namePx = fitPx(ctx, person.name, 500, 100 * s, 30 * s, maxW);
    drawAt(ctx, person.name, x, yy(Y.name), color);

    if (meta.isInter) {
      var what;
      if (kind === 'winner') what = 'for Winning ' + meta.eventName;
      else if (kind === 'runner') what = 'for being the Runner in ' + meta.eventName;
      else what = 'for participating in ' + meta.eventName;
      var sentence = (person.college ? 'of ' + person.college + ' ' : '') + what +
        (org ? ' conducted by ' + org : '') + (date ? ' from ' + date : '');
      var fit = wrapToFit(ctx, sentence, 400, 50 * s, 34 * s, maxW, 4);
      setFont(ctx, 400, fit.px);
      fit.lines.forEach(function (line, i) { drawAt(ctx, line, x, yy(Y.lines + i * Y.step), color); });
    } else {
      setFont(ctx, 300, 50 * s);
      drawAt(ctx, 'For participating in', x, yy(Y.lines), color);
      fitPx(ctx, meta.eventName, 500, 60 * s, 30 * s, maxW);
      drawAt(ctx, meta.eventName, x, yy(Y.event), color);
      var gap = 40 * s, cx;
      if (org) {
        setFont(ctx, 300, 50 * s);
        var baseBy = drawAt(ctx, 'Conducted by', x, yy(Y.by), color);
        cx = x + ctx.measureText('Conducted by').width + gap;
        fitPx(ctx, org, 500, 60 * s, 30 * s, Math.max(200 * s, maxW - (cx - x)));
        drawOnBaseline(ctx, org, cx, baseBy, color);
      }
      if (date) {
        setFont(ctx, 300, 50 * s);
        var baseOn = drawAt(ctx, 'on', x, yy(Y.on), color);
        cx = x + ctx.measureText('on').width + gap;
        setFont(ctx, 500, 60 * s);
        drawOnBaseline(ctx, date, cx, baseOn, color);
      }
    }
    return kind;
  }

  function toBlob(canvas) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error('The browser could not create the image (page too large?)')); }, 'image/png');
    });
  }

  // ======================================================================
  // Templates (saved in the storage bucket under <club_id>/_templates/)
  // ======================================================================
  var tpl = {};                                    // kind -> { path, url, bitmap }
  var tplRow = $('tpl-row');

  async function fetchBitmap(url) {
    var r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return createImageBitmap(await r.blob());
  }

  async function loadTemplateList() {
    tpl = {};
    var r = await store().list(ROOT + '_templates', { limit: 100 });
    if (r.error) { console.warn('template list failed', r.error); return; }
    for (var i = 0; i < r.data.length; i++) {
      var f = r.data[i], kind = f.name.replace(/\.[^.]+$/, '');
      if (KINDS.indexOf(kind) === -1 || !f.id) continue;
      var path = ROOT + '_templates/' + f.name;
      var url = store().getPublicUrl(path).data.publicUrl + '?v=' + encodeURIComponent(f.updated_at || f.created_at || '1');
      tpl[kind] = { path: path, url: url, bitmap: null };
    }
  }
  async function getTemplateBitmap(kind) {
    var t = tpl[kind];
    if (!t) return null;
    if (!t.bitmap) t.bitmap = await fetchBitmap(t.url);
    return t.bitmap;
  }

  function drawThumb(canvas, kind) {
    var w = 360, h = Math.round(w * REF_H / REF_W);
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var t = tpl[kind];
    if (t && t.bitmap) ctx.drawImage(t.bitmap, 0, 0, w, h); else drawDefaultTemplate(ctx, w, h, kind);
  }

  async function renderTemplateCards() {
    await loadFonts().catch(function () {});
    tplRow.innerHTML = KINDS.map(function (k) {
      var t = tpl[k];
      return '<div class="col-md-4 mb-3"><div class="border rounded p-2 h-100">' +
        '<div class="font-weight-bold mb-1">' + KIND_LABEL[k] + ' <span class="badge ' + (t ? 'badge-success' : 'badge-secondary') + '">' + (t ? 'custom' : 'built-in') + '</span></div>' +
        '<canvas id="thumb-' + k + '" style="width:100%;height:auto" class="border mb-2"></canvas>' +
        '<div><input type="file" accept="image/png,image/jpeg,image/webp" id="file-' + k + '" style="display:none">' +
        '<button class="btn btn-sm btn-primary mr-1" type="button" data-act="up" data-k="' + k + '"><i class="fas fa-upload mr-1"></i>' + (t ? 'Replace' : 'Upload') + '</button>' +
        (t ? '<button class="btn btn-sm btn-outline-danger" type="button" data-act="reset" data-k="' + k + '"><i class="fas fa-undo mr-1"></i>Use built-in</button>' : '') +
        '</div></div></div>';
    }).join('');
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      try { await getTemplateBitmap(k); } catch (e) {
        console.warn('template load failed', k, e);
        tpl[k].bitmap = null;
        flash('warning', 'The saved ' + KIND_LABEL[k] + ' template could not be loaded (' + esc(e.message) + '). The built-in design is shown instead.');
      }
      drawThumb($('thumb-' + k), k);
    }
  }

  tplRow.addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var k = b.dataset.k;
    if (b.dataset.act === 'up') { $('file-' + k).click(); return; }
    if (!window.confirm('Remove the custom ' + KIND_LABEL[k] + ' template and go back to the built-in design?')) return;
    b.disabled = true;
    var r = await store().remove([tpl[k].path]);
    if (r.error) { flash('danger', 'Could not remove the template: ' + esc(r.error.message)); b.disabled = false; return; }
    await REMS.log('Removed ' + KIND_LABEL[k] + ' certificate template');
    await loadTemplateList(); await renderTemplateCards();
  });
  tplRow.addEventListener('change', async function (e) {
    var input = e.target;
    if (!input.id || input.id.indexOf('file-') !== 0 || !input.files.length) return;
    var k = input.id.slice(5), file = input.files[0];
    input.value = '';
    var ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
    if (!ext) { flash('danger', 'Templates must be PNG, JPG or WebP images.'); return; }
    if (file.size > MAX_TPL_BYTES) { flash('danger', 'That image is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is 10 MB.'); return; }
    var bmp;
    try { bmp = await createImageBitmap(file); } catch (err) { flash('danger', 'That file could not be read as an image.'); return; }
    if (bmp.width < 800 || bmp.width * bmp.height > 60e6) { flash('danger', 'The image is ' + bmp.width + ' x ' + bmp.height + ' px. Use a width between 800 and about 8000 px.'); bmp.close(); return; }
    var ratio = bmp.width / bmp.height, warn = Math.abs(ratio - REF_W / REF_H) > 0.05;
    bmp.close();
    try {
      var old = tpl[k] && tpl[k].path, path = ROOT + '_templates/' + k + '.' + ext;
      var up = await store().upload(path, file, { upsert: true, contentType: file.type, cacheControl: '300' });
      if (up.error) throw up.error;
      if (old && old !== path) await store().remove([old]);     // different extension: drop the old file
      await REMS.log('Uploaded ' + KIND_LABEL[k] + ' certificate template');
      await loadTemplateList(); await renderTemplateCards();
      flash(warn ? 'warning' : 'success', KIND_LABEL[k] + ' template saved.' + (warn ? ' Note: it is not A4 landscape, so the text positions may need the Layout settings.' : ''));
    } catch (err) {
      console.error(err);
      flash('danger', 'Upload failed: ' + esc(err.message || 'unknown error'));
    }
  });

  // ======================================================================
  // Form state, preview
  // ======================================================================
  var people = [];          // parsed CSV rows
  var running = false, cancelled = false;

  $('org-name').value = REMS.cfg.ORG_NAME || '';
  function syncTypeHelp() {
    $('type-help').textContent = $('event-type').value === '1'
      ? 'Inter-college: the certificate says "of <college> for participating in ...". Rows with position Winner or Runner use those templates.'
      : 'Intra-college: shows the name, event, organiser and date. The Participation template is used for everyone.';
  }
  $('event-type').addEventListener('change', function () { syncTypeHelp(); schedulePreview(); });
  syncTypeHelp();

  function readLayout() {
    var num = function (id, d, lo, hi) { var v = parseFloat($(id).value); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    return { x: num('lay-x', 206, 0, 1500), dy: num('lay-y', 0, -600, 600), w: num('lay-w', 2000, 600, 3300), color: /^#[0-9a-f]{6}$/i.test($('lay-c').value) ? $('lay-c').value : '#535453' };
  }
  function readMeta() {
    return { eventName: $('event-name').value.trim().replace(/\s+/g, ' '), dateIso: $('event-date').value, isInter: $('event-type').value === '1', org: $('org-name').value.trim() };
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
      var shown = res.errors.slice(0, 8).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('');
      html += '<div class="alert alert-danger py-2 mb-1"><strong>Please fix the file and choose it again:</strong><ul class="mb-0 pl-4">' + shown +
        (res.errors.length > 8 ? '<li>&hellip; and ' + (res.errors.length - 8) + ' more</li>' : '') + '</ul></div>';
    } else {
      people = res.people;
      var inter = people.filter(function (p) { return p.college; }).length;
      html += '<div class="alert alert-success py-2 mb-1"><i class="fas fa-check mr-1"></i>' + people.length + ' people found (' + esc(f.name) + ', ' + (f.size / 1024).toFixed(1) + ' KB).' +
        (inter && $('event-type').value === '0' ? ' <small>This file has college names: if it is an inter-college event, change the event type.</small>' : '') + '</div>';
    }
    res.warnings.forEach(function (w) { html += '<div class="alert alert-warning py-2 mb-1">' + esc(w) + '</div>'; });
    $('csv-info').innerHTML = html;
    schedulePreview();
  });

  var previewTimer = null;
  function schedulePreview() {
    if ($('preview-card').style.display === 'none') return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { showPreview(true); }, 250);
  }
  async function showPreview(quiet) {
    var meta = readMeta();
    if (!meta.eventName) meta.eventName = 'Sample Workshop';
    if (!meta.dateIso) { var d = new Date(); meta.dateIso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    var person = people[0] || { name: 'Sample Participant', college: 'Sample College', position: meta.isInter ? 'Winner' : null };
    try {
      await loadFonts();
      var kind = positionKind(person.position, meta.isInter), bmp = null;
      try { bmp = await getTemplateBitmap(kind); } catch (e) { bmp = null; }
      renderCertificate($('preview-canvas'), bmp, person, meta, readLayout());
      $('preview-for').textContent = '(' + (people[0] ? 'first person in your CSV' : 'sample data') + ', ' + KIND_LABEL[kind] + ' template)';
      $('preview-card').style.display = '';
      if (!quiet) $('preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      flash('danger', 'Could not draw the preview: ' + esc(err.message || 'unknown error') + '. Check that the font files in assets/fonts/raleway are deployed.');
    }
  }
  $('preview-btn').addEventListener('click', function () { showPreview(false); });
  ['lay-x', 'lay-y', 'lay-w', 'lay-c', 'event-name', 'event-date', 'org-name'].forEach(function (id) { $(id).addEventListener('input', schedulePreview); });

  // ======================================================================
  // Generate
  // ======================================================================
  function setProgress(done, total, text) {
    var pct = total ? Math.round(done * 100 / total) : 0;
    $('progress-bar').style.width = pct + '%'; $('progress-bar').textContent = pct + '%';
    $('progress-text').textContent = text || '';
  }
  function setRunning(on) {
    running = on; cancelled = false;
    $('gen-btn').disabled = on; $('preview-btn').disabled = on;
    $('cancel-btn').style.display = on ? '' : 'none';
    $('progress-wrap').style.display = on ? '' : 'block';
    ['csv-file', 'event-name', 'event-date', 'event-type', 'org-name'].forEach(function (id) { $(id).disabled = on; });
  }
  window.addEventListener('beforeunload', function (e) { if (running) { e.preventDefault(); e.returnValue = ''; } });
  $('cancel-btn').addEventListener('click', function () { cancelled = true; $('cancel-btn').disabled = true; $('progress-text').textContent = 'Stopping...'; });

  // Remove every file under a storage folder (recursing one level into run folders).
  async function listFiles(prefix) {
    var out = [], offset = 0;
    for (;;) {
      var r = await store().list(prefix, { limit: 1000, offset: offset, sortBy: { column: 'name', order: 'asc' } });
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < 1000) break;
      offset += 1000;
    }
    return out;
  }
  async function purge(slug, keepRun) {
    var top = await listFiles(slug), paths = [];
    for (var i = 0; i < top.length; i++) {
      var e = top[i];
      if (keepRun && e.name === keepRun) continue;
      if (e.id === null) {
        var inner = await listFiles(slug + '/' + e.name);
        inner.forEach(function (f) { if (f.id !== null) paths.push(slug + '/' + e.name + '/' + f.name); });
      } else paths.push(slug + '/' + e.name);
    }
    for (var j = 0; j < paths.length; j += 100) {
      var rm = await store().remove(paths.slice(j, j + 100));
      if (rm.error) throw rm.error;
    }
    return paths.length;
  }

  async function findEvent(name) {
    var r = await sb.from('events').select('event_name,club_id').ilike('event_name', escLike(name)).limit(1);
    if (r.error) throw r.error;
    // Event names are public lookup keys, so they are unique across all clubs.
    if (r.data.length && r.data[0].club_id !== CLUB) throw new Error('An event with this name already exists in another club. Use a different event name.');
    return r.data.length ? r.data[0].event_name : null;
  }

  $('cert-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (running) return;
    $('msg').innerHTML = '';
    var meta = readMeta();
    if (!people.length) { flash('danger', 'Choose a valid CSV file first.'); return; }
    if (!meta.eventName) { flash('danger', 'Please enter the event name.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.dateIso)) { flash('danger', 'Please choose the event date.'); return; }
    var slug = slugify(meta.eventName);
    if (!slug) { flash('danger', 'The event name needs letters or numbers.'); return; }
    var lay = readLayout();

    setRunning(true);
    $('result-card').style.display = 'none';
    var runId = Date.now().toString(36), uploaded = [], inflight = [], failure = null;
    var total = people.length, done = 0;
    try {
      setProgress(0, total, 'Checking the event...');
      var existing = await findEvent(meta.eventName);
      var oldIds = [];
      if (existing) {
        meta.eventName = existing;                                  // keep the stored spelling so public lookups match
        var old = await sb.from('certificates').select('id').eq('club_id', CLUB).eq('event_name', existing).limit(5000);
        if (old.error) throw old.error;
        oldIds = old.data.map(function (r) { return r.id; });
        if (!window.confirm('"' + existing + '" already exists with ' + oldIds.length + ' certificate' + (oldIds.length === 1 ? '' : 's') +
          '.\nGenerate again and replace them? (The old certificate links stop working.)')) { setRunning(false); return; }
      }

      setProgress(0, total, 'Loading fonts and templates...');
      await loadFonts();
      var bitmaps = {};
      for (var ki = 0; ki < KINDS.length; ki++) {
        var needed = people.some(function (p) { return positionKind(p.position, meta.isInter) === KINDS[ki]; });
        if (needed) { try { bitmaps[KINDS[ki]] = await getTemplateBitmap(KINDS[ki]); } catch (err) { throw new Error('The saved ' + KIND_LABEL[KINDS[ki]] + ' template could not be loaded: ' + err.message); } }
      }

      var canvas = document.createElement('canvas');
      var rows = [];
      for (var i = 0; i < total; i++) {
        if (cancelled) throw new Error('__cancelled__');
        if (failure) throw failure;
        var person = people[i];
        var kind = renderCertificate(canvas, bitmaps[positionKind(person.position, meta.isInter)] || null, person, meta, lay);
        var blob = await toBlob(canvas);
        var path = ROOT + slug + '/' + runId + '/Certificate-' + (i + 1) + '.png';
        (function (path, i) {
          var p = store().upload(path, blob, { contentType: 'image/png', cacheControl: '31536000' }).then(function (r) {
            if (r.error) throw r.error;
            uploaded.push(path); done++;
            setProgress(done, total, 'Created ' + done + ' of ' + total + ' certificates');
          }).catch(function (err) { failure = failure || err; });
          inflight.push(p);
          p.then(function () { inflight.splice(inflight.indexOf(p), 1); });
        })(path, i);
        rows.push({
          name: person.name, regno: person.regno, dept: person.dept, year: person.year, section: person.section,
          email: person.email, position: person.position, college: person.college,
          club_id: CLUB, event_name: meta.eventName, cert_link: store().getPublicUrl(path).data.publicUrl
        });
        while (inflight.length >= 3) await Promise.race(inflight);
      }
      await Promise.all(inflight);
      if (failure) throw failure;
      if (cancelled) throw new Error('__cancelled__');

      // Everything is uploaded: now touch the database. Insert first, delete the old rows after,
      // so a failure never leaves the event without certificates.
      setProgress(total, total, 'Saving records...');
      for (var b = 0; b < rows.length; b += 100) {
        var ins = await sb.from('certificates').insert(rows.slice(b, b + 100));
        if (ins.error) {
          // roll back the part already inserted for this run
          await sb.from('certificates').delete().in('cert_link', rows.slice(0, b + 100).map(function (r) { return r.cert_link; }));
          throw ins.error;
        }
      }
      var warnings = [];
      for (var d = 0; d < oldIds.length; d += 100) {
        var del = await sb.from('certificates').delete().in('id', oldIds.slice(d, d + 100));
        if (del.error) { warnings.push('The old certificate records could not all be removed (' + del.error.message + '). Open the DB manager to delete duplicates.'); break; }
      }
      var ev = await sb.from('events').upsert({ club_id: CLUB, event_name: meta.eventName, date: meta.dateIso, is_inter: meta.isInter }, { onConflict: 'event_name' });
      if (ev.error) warnings.push('The certificates were saved but the event row was not (' + ev.error.message + '); they will not show on the public event list.');
      try { await purge(ROOT + slug, runId); } catch (err) { console.warn('cleanup of old files failed', err); }

      await REMS.log((existing ? 'Regenerated ' : 'Generated ') + total + ' certificates for ' + meta.eventName);
      showResults(rows, meta.isInter);
      flash(warnings.length ? 'warning' : 'success', 'Generation completed: ' + total + ' certificate' + (total === 1 ? '' : 's') + ' for <strong>' + esc(meta.eventName) + '</strong>. ' +
        '<a class="alert-link" href="cds-public.html?event=' + encodeURIComponent(meta.eventName) + '" target="_blank" rel="noopener">Open the public page</a>.' +
        warnings.map(function (w) { return '<br>' + esc(w); }).join(''));
      await loadEvents();
    } catch (err) {
      await Promise.all(inflight);
      // Remove what this run uploaded; nothing in the database was changed yet (or it was rolled back).
      if (uploaded.length) { try { await store().remove(uploaded.slice(0, 1000)); } catch (e2) {} }
      if (err && err.message === '__cancelled__') flash('warning', 'Stopped. Nothing was saved.');
      else { console.error(err); flash('danger', 'Generation failed, nothing was saved: ' + esc((err && err.message) || 'unknown error')); }
    } finally {
      setRunning(false);
      $('cancel-btn').disabled = false;
      $('progress-wrap').style.display = 'none';
    }
  });

  function showResults(rows, isInter) {
    $('th-2').textContent = isInter ? 'College' : 'Reg No';
    $('result-body').innerHTML = rows.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(isInter ? r.college : r.regno) + '</td><td>' + esc(r.position) +
        '</td><td><a href="' + esc(r.cert_link) + '" target="_blank" rel="noopener">Link</a></td></tr>';
    }).join('');
    $('result-card').style.display = '';
  }

  // ======================================================================
  // Generated events list
  // ======================================================================
  var events = [];
  async function loadEvents() {
    var r = await sb.from('events').select('event_name,date,is_inter').eq('club_id', CLUB).order('date', { ascending: false }).order('event_name').limit(50);
    if (r.error) { $('events-body').innerHTML = '<tr><td colspan="5" class="text-danger">Could not load events: ' + esc(r.error.message) + '</td></tr>'; return; }
    events = r.data;
    if (!events.length) { $('events-body').innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No events yet.</td></tr>'; return; }
    var counts = await Promise.all(events.map(function (ev) {
      return sb.from('certificates').select('id', { count: 'exact', head: true }).eq('event_name', ev.event_name).then(function (c) { return c.error ? '?' : c.count; });
    }));
    $('events-body').innerHTML = events.map(function (ev, i) {
      return '<tr><td class="font-weight-bold"><a href="cds-public.html?event=' + encodeURIComponent(ev.event_name) + '" target="_blank" rel="noopener">' + esc(ev.event_name) + '</a></td>' +
        '<td class="text-nowrap">' + esc(fmtDate(ev.date) || ev.date) + '</td><td>' + (ev.is_inter ? 'Inter-college' : 'Intra-college') + '</td>' +
        '<td class="text-center">' + counts[i] + '</td>' +
        '<td class="text-right"><button class="btn btn-danger btn-sm" type="button" data-i="' + i + '" aria-label="Delete event"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  }
  $('events-body').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || running) return;
    var ev = events[parseInt(b.dataset.i, 10)];
    if (!window.confirm('Delete the event "' + ev.event_name + '" with all its certificates and image files?\nThe public links stop working. This cannot be undone.')) return;
    b.disabled = true;
    try {
      var c = await sb.from('certificates').delete().eq('event_name', ev.event_name);
      if (c.error) throw c.error;
      var d = await sb.from('events').delete().eq('event_name', ev.event_name);
      if (d.error) throw d.error;
      var files = 0;
      try { files = await purge(ROOT + slugify(ev.event_name), null); } catch (err) { console.warn('file cleanup failed', err); }
      await REMS.log('Deleted event ' + ev.event_name + ' (' + files + ' files)');
      flash('success', 'Event "' + esc(ev.event_name) + '" deleted.');
      await loadEvents();
    } catch (err) {
      flash('danger', 'Delete failed: ' + esc(err.message || 'unknown error'));
      b.disabled = false;
    }
  });

  // Exposed for tests and for the browser console.
  window.REMS_CERT = { parseCsv: parseCsv, readPeople: readPeople, slugify: slugify, fmtDate: fmtDate, positionKind: positionKind };

  syncTypeHelp();
  try { await loadTemplateList(); } catch (err) { console.warn(err); }
  await renderTemplateCards();
  await loadEvents();
})();
