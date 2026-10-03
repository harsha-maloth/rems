/* Profile page: edit your own details and picture. Email/username are admin-only (DB trigger). */
(async function () {
  'use strict';
  document.title = 'Edit Profile: ' + (REMS.cfg.APP_NAME || REMS.cfg.ORG_NAME);
  var profile;
  try { profile = await REMS.requireAuth(); } catch (e) { return; }
  await REMS.mountLayout();
  document.body.style.visibility = 'visible';

  var sb = REMS.sb, esc = REMS.esc;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('profile-form'), msg = $('msg'), saveBtn = $('save-btn');
  var preview = $('pic-preview'), removeBtn = $('pic-remove');
  var newPicture = null;       // undefined/null = unchanged, '' = remove, data URL = replace
  var pictureChanged = false;

  function flash(kind, text) {
    msg.innerHTML = '<div class="alert alert-' + kind + ' alert-dismissible" role="alert">' + esc(text) +
      '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>';
    window.scrollTo(0, 0);
  }

  function fill(p) {
    $('login_name').value = p.login_name || '';
    $('email').value = p.email || '';
    $('first_name').value = p.first_name || '';
    $('last_name').value = p.last_name || '';
    $('address').value = p.address || '';
    $('phno').value = p.phno || '';
    $('signature').value = p.signature || '';
    var has = p.imgsrc && String(p.imgsrc).indexOf('data:image/') === 0;
    preview.src = has ? p.imgsrc : REMS.DEFAULT_AVATAR;
    removeBtn.style.display = has ? '' : 'none';
  }
  fill(profile);

  // Resize to a 256x256 square (cover) JPEG so the stored data URL stays small (~15-30 KB).
  function resize(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Please choose a PNG, JPEG, WebP or GIF image.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('That image is over 8 MB. Please choose a smaller one.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var S = 256, c = document.createElement('canvas');
        c.width = c.height = S;
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  $('picture').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    if (!f) return;
    try {
      newPicture = await resize(f);
      pictureChanged = true;
      preview.src = newPicture;
      $('picture-label').textContent = f.name;
      removeBtn.style.display = '';
    } catch (err) {
      e.target.value = '';
      flash('danger', err.message);
    }
  });

  removeBtn.addEventListener('click', function () {
    newPicture = ''; pictureChanged = true;
    preview.src = REMS.DEFAULT_AVATAR;
    $('picture').value = '';
    $('picture-label').textContent = 'Choose picture';
    removeBtn.style.display = 'none';
  });

  function clean(s) { return String(s || '').trim(); }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    msg.innerHTML = '';
    var phone = clean($('phno').value);
    var ok = true;
    ['first_name', 'last_name'].forEach(function (id) {
      var bad = !clean($(id).value);
      $(id).classList.toggle('is-invalid', bad);
      if (bad) ok = false;
    });
    var badPhone = phone && !/^[0-9+()\s-]+$/.test(phone);
    $('phno').classList.toggle('is-invalid', !!badPhone);
    if (badPhone) ok = false;
    if (!ok) return;

    var first = clean($('first_name').value), last = clean($('last_name').value);
    var changes = {
      first_name: first,
      last_name: last,
      full_name: (first + ' ' + last).trim(),
      address: clean($('address').value) || null,
      phno: phone || null,
      signature: clean($('signature').value) || null
    };
    var hadPic = pictureChanged;
    if (pictureChanged) changes.imgsrc = newPicture || null;

    saveBtn.disabled = true;
    var label = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    try {
      var r = await sb.from('profiles').update(changes).eq('id', profile.id).select().single();
      if (r.error) throw r.error;
      REMS.profile = profile = r.data;
      newPicture = null; pictureChanged = false;
      fill(profile);
      await REMS.log(hadPic ? 'Updated profile picture' : 'Updated profile details');
      flash('success', 'Profile updated.');
    } catch (err) {
      console.error(err);
      flash('danger', 'Could not save your profile: ' + (err.message || 'unknown error'));
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = label;
    }
  });
})();
