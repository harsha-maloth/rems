(async function () {
  'use strict';
  document.title = 'Send email: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  try { await REMS.requireAuth({ perm: 'mail.send' }); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc, cfg = REMS.cfg;
  var $ = function (id) { return document.getElementById(id); };
  var BATCH = 10;
  var counts = {};
  var running = false, stopRequested = false;

  function flash(kind, html) {
    if (REMS.toastIfShort(kind, html)) { $('msg').innerHTML = ''; return; }
    $('msg').innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + html +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }

  $('m-btn-label').value = cfg.MAIL_BUTTON_LABEL || 'Click here';
  $('m-btn-url').value = cfg.MAIL_BUTTON_URL || '';
  $('m-logo').value = cfg.MAIL_LOGO_URL || '';
  $('m-cover').value = cfg.MAIL_COVER_URL || '';

  function httpUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    try { var u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; }
  }
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (m) {
      var trail = (m.match(/[.,;:!?)]+$/) || [''])[0];
      var url = trail ? m.slice(0, -trail.length) : m;
      return '<a href="' + url + '" style="color:#4e73df">' + url + '</a>' + trail;
    });
  }
  function bodyHtml(text) {
    var paras = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    return paras.map(function (p) {
      return '<p style="margin:0 0 16px;line-height:1.6">' + linkify(esc(p)).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function buildMail(f) {
    var errors = [];
    var logo = httpUrl(f.logo), cover = httpUrl(f.cover), btn = httpUrl(f.btnUrl);
    if (logo === null) errors.push('The logo link must start with https://');
    if (cover === null) errors.push('The cover image link must start with https://');
    if (btn === null) errors.push('The button link must start with https://');
    var html = '<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb"><tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:6px;font-family:Arial,Helvetica,sans-serif;color:#333333">' +
      (logo ? '<tr><td align="center" style="padding:24px 24px 0"><img src="' + esc(logo) + '" alt="" style="max-width:200px;height:auto;border:0"></td></tr>' : '') +
      (f.title ? '<tr><td style="padding:24px 24px 8px"><h2 style="margin:0;font-size:22px;color:#222222">' + esc(f.title) + '</h2></td></tr>' : '') +
      '<tr><td style="padding:8px 24px 8px;font-size:15px">' + bodyHtml(f.body) + '</td></tr>' +
      (btn && f.btnLabel ? '<tr><td align="center" style="padding:8px 24px 24px"><a href="' + esc(btn) + '" style="display:inline-block;padding:12px 24px;background:#4e73df;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold">' + esc(f.btnLabel) + '</a></td></tr>' : '') +
      (cover ? '<tr><td style="padding:0"><img src="' + esc(cover) + '" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:0 0 6px 6px"></td></tr>' : '') +
      '<tr><td align="center" style="padding:16px 24px;font-size:12px;color:#888888">Sent by ' + esc(cfg.ORG_NAME || '') + '</td></tr>' +
      '</table></td></tr></table></body></html>';
    var text = (f.title ? f.title + '\n\n' : '') + f.body.trim() + (btn && f.btnLabel ? '\n\n' + f.btnLabel + ': ' + btn : '') + '\n\n-- ' + (cfg.ORG_NAME || '');
    return { html: html, text: text, errors: errors };
  }
  function readForm() {
    return {
      listId: $('m-list').value, subject: $('m-subject').value.replace(/\s+/g, ' ').trim(),
      title: $('m-title').value.replace(/\s+/g, ' ').trim(), body: $('m-body').value,
      btnLabel: $('m-btn-label').value.trim(), btnUrl: $('m-btn-url').value,
      logo: $('m-logo').value, cover: $('m-cover').value
    };
  }

  var previewTimer = null;
  function renderPreview() {
    var m = buildMail(readForm());
    $('preview').srcdoc = m.html;
  }
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 250); }
  ['m-subject', 'm-title', 'm-body', 'm-btn-label', 'm-btn-url', 'm-logo', 'm-cover'].forEach(function (id) { $(id).addEventListener('input', schedulePreview); });
  renderPreview();

  async function loadLists() {
    var r = await sb.from('mailing_lists').select('id,name,mailing_list_members(count)').eq('club_id', REMS.clubId()).order('name');
    if (r.error) { $('m-list').innerHTML = '<option value="">Could not load lists</option>'; flash('danger', esc(r.error.message)); return; }
    var opts = '<option value="">Select a mailing list</option>';
    r.data.forEach(function (l) {
      var n = (l.mailing_list_members && l.mailing_list_members[0] && l.mailing_list_members[0].count) || 0;
      counts[l.id] = n;
      opts += '<option value="' + l.id + '">' + esc(l.name) + ' (' + n + ')</option>';
    });
    $('m-list').innerHTML = opts;
    if (!r.data.length) $('m-list').innerHTML = '<option value="">No lists yet: create one first</option>';
  }

  async function callFn(payload) {
    payload.club_id = REMS.clubId();
    var res = await sb.functions.invoke('send-bulk-mail', { body: payload });
    if (res.error) {
      var msg = res.error.message || 'Request failed';
      try { if (res.error.context && res.error.context.json) { var j = await res.error.context.json(); if (j && j.error) msg = j.error; } } catch (e) {}
      var err = new Error(msg); err.fatal = /SMTP is not set up|not allowed to send|sign in|daily limit/i.test(msg); throw err;
    }
    return res.data;
  }
  function setBusy(on) {
    running = on;
    ['m-list', 'm-subject', 'm-title', 'm-body', 'm-btn-label', 'm-btn-url', 'm-logo', 'm-cover', 'test-btn', 'send-btn'].forEach(function (id) { $(id).disabled = on; });
    $('stop-btn').style.display = on ? '' : 'none';
  }
  function validate(f, needList) {
    if (needList && !f.listId) return 'Choose a mailing list.';
    if (!f.subject) return 'Write a subject.';
    if (!f.body.trim()) return 'Write a message.';
    var m = buildMail(f);
    return m.errors.length ? m.errors[0] : '';
  }
  function csvFailed(rows) {
    var csv = 'email,error\r\n' + rows.map(function (r) {
      return [r.email, r.error].map(function (v) { v = String(v).replace(/"/g, '""'); return /[",\r\n]/.test(v) ? '"' + v + '"' : v; }).join(',');
    }).join('\r\n') + '\r\n';
    return URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  }

  $('test-btn').addEventListener('click', async function () {
    var f = readForm(), bad = validate(f, false);
    if (bad) return flash('warning', esc(bad));
    var m = buildMail(f);
    setBusy(true); $('result').innerHTML = '';
    try {
      var r = await callFn({ test: true, subject: '[TEST] ' + f.subject, html: m.html, text: m.text });
      if (r.sent === 1) flash('success', 'Test e-mail sent to your own address. Check your inbox (and spam folder).');
      else flash('danger', 'The test e-mail failed: ' + esc((r.failed[0] && r.failed[0].error) || 'unknown error'));
    } catch (e) { flash('danger', esc(e.message)); }
    setBusy(false);
  });

  $('stop-btn').addEventListener('click', function () { stopRequested = true; $('stop-btn').disabled = true; });

  $('mail-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (running) return;
    var f = readForm(), bad = validate(f, true);
    if (bad) return flash('warning', esc(bad));
    var total = counts[f.listId] || 0;
    if (!total) return flash('warning', 'That list has no people.');
    var listName = $('m-list').selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, '');
    if (!await REMS.confirm('Send "' + f.subject + '" to ' + total + ' people in "' + listName + '"?\n\nTip: send a test to yourself first. Keep this tab open until it finishes.', { title: 'Send email', ok: 'Send', danger: false })) return;

    var m = buildMail(f), done = 0, sent = 0, failed = [], error = null;
    stopRequested = false; $('stop-btn').disabled = false;
    setBusy(true); $('result').innerHTML = ''; $('progress-box').style.display = '';
    function progress() {
      var pct = Math.round(done / total * 100);
      $('progress-bar').style.width = pct + '%'; $('progress-bar').textContent = pct + '%';
      $('progress-text').textContent = sent + ' sent' + (failed.length ? ', ' + failed.length + ' failed' : '') + ' of ' + total;
    }
    progress();
    while (done < total && !stopRequested) {
      var r;
      try { r = await callFn({ list_id: Number(f.listId), offset: done, limit: BATCH, subject: f.subject, html: m.html, text: m.text }); }
      catch (err) { error = err; break; }
      sent += r.sent; failed = failed.concat(r.failed); done += r.count;
      progress();
      if (r.count === 0) break;
    }
    setBusy(false);

    var html;
    if (error) html = '<div class="alert alert-danger"><strong>Sending stopped</strong> after ' + sent + ' e-mails: ' + esc(error.message) + '.<br>Nothing after address number ' + done + ' was sent, so do not send the whole list again.</div>';
    else if (stopRequested && done < total) html = '<div class="alert alert-warning"><strong>Stopped.</strong> ' + sent + ' sent. Addresses 1 to ' + done + ' of ' + total + ' were handled; the rest were not mailed.</div>';
    else html = '<div class="alert alert-' + (failed.length ? 'warning' : 'success') + '"><strong>Finished.</strong> ' + sent + ' of ' + total + ' e-mails sent.</div>';
    if (failed.length) {
      html += '<div class="alert alert-warning py-2"><strong>' + failed.length + ' address(es) failed.</strong> ' +
        '<a href="' + csvFailed(failed) + '" download="failed_addresses.csv">Download the list</a><ul class="mb-0 pl-4 small">' +
        failed.slice(0, 5).map(function (x) { return '<li>' + esc(x.email) + ': ' + esc(x.error) + '</li>'; }).join('') +
        (failed.length > 5 ? '<li>&hellip;</li>' : '') + '</ul></div>';
    }
    $('result').innerHTML = html;
    await REMS.log('Bulk mail "' + f.subject.slice(0, 80) + '" to list "' + listName + '": ' + sent + ' sent, ' + failed.length + ' failed' + (done < total ? ', stopped at ' + done + ' of ' + total : ''));
  });

  window.addEventListener('beforeunload', function (ev) { if (running) { ev.preventDefault(); ev.returnValue = ''; } });
  await loadLists();
})();
