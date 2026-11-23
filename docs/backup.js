// Backup and restore: everything the app keeps on this device except the games themselves. Saved words,
// known words, review schedule, flashcard screenshots, reading stats, settings, every game's in-game save
// and its newest resume snapshot (about 1.5 MB a game), so a restore picks up where you left off.
// To a file (share sheet / download), or to the user's own Google Drive (hidden app folder).
(function () {
  'use strict';
  // Google OAuth client id for codetaal.github.io (Google Cloud console > APIs & Services > Credentials).
  // Empty: the Google Drive option is hidden.
  var GOOGLE_CLIENT_ID = '524828905859-b17dphmp7rl9dgv8onpjtsbddn5gldh6.apps.googleusercontent.com';
  // Each tap on "Back up to Google Drive" makes a new backup; the quiet backup when you leave the app updates
  // the day's automatic one instead (so it doesn't push your own backups out). The newest KEEP are kept, so
  // Restore can go back. Older versions used a single 'cramboy-backup.json.gz', which counts as one of them.
  var DRIVE_PREFIX = 'cramboy-backup', KEEP = 5;
  // Not backed up: the games (and the list of them, which would point at games a new device doesn't have),
  // the older resume snapshots (only the newest, snap:<game>, goes along), and the backup's own bookkeeping.
  var SKIP = /^(rom($|:)|library$|snap-(prev|kept):|backup-)/;

  function b64(u8) { var s = '', i; for (i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // Values are JSON, strings, or binary (game saves): binary is stored as {"$b64": "..."}.
  // A resume snapshot is an object holding binary ({t, app, data}), so plain objects get one level more.
  function enc(v, deep) {
    if (v instanceof ArrayBuffer) return { $b64: b64(new Uint8Array(v)), $ab: 1 };
    if (ArrayBuffer.isView(v)) return { $b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (deep !== false && v && typeof v === 'object' && !Array.isArray(v)) {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = enc(v[k], false); }); return o;
    }
    return v;
  }
  function dec(v, deep) {
    if (v && typeof v === 'object' && typeof v.$b64 === 'string') { var u = unb64(v.$b64); return v.$ab ? u.buffer : u; }
    if (deep !== false && v && typeof v === 'object' && !Array.isArray(v)) {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = dec(v[k], false); }); return o;
    }
    return v;
  }

  function collect() {
    return KV.keys().then(function (keys) {
      keys = keys.filter(function (k) { return typeof k === 'string' && !SKIP.test(k); });
      return Promise.all(keys.map(function (k) { return KV.get(k); })).then(function (vals) {
        var data = {}; keys.forEach(function (k, i) { data[k] = enc(vals[i]); });
        return { app: 'CramBoy', format: 1, version: window.APP_VERSION || '', at: new Date().toISOString(), data: data };
      });
    });
  }
  function gzip(text) {
    if (!window.CompressionStream) return Promise.resolve(new Blob([text], { type: 'application/json' }));
    return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
      .then(function (b) { return new Blob([b], { type: 'application/gzip' }); });
  }
  function readBackup(blob) {
    return blob.slice(0, 2).arrayBuffer().then(function (h) {
      var u = new Uint8Array(h), gz = u[0] === 0x1f && u[1] === 0x8b;
      if (gz && !window.DecompressionStream) throw new Error('This browser can’t open compressed backups.');
      return gz ? new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : blob.text();
    }).then(function (t) {
      var j = JSON.parse(t);
      if (!j || j.app !== 'CramBoy' || !j.data) throw new Error('This is not a CramBoy backup.');
      return j;
    });
  }
  // A game's resume snapshots belong to its old save: for every game whose save comes back, the backup's
  // own snapshot replaces them, and without one (older backups) they go, so starting it doesn't jump to a
  // moment that doesn't match the restored save.
  function apply(j) {
    var keys = Object.keys(j.data);
    if (window.cbBeforeRestore) window.cbBeforeRestore();   // a game that's open stops saving (emu.js)
    var snaps = [];
    keys.forEach(function (k) {
      var m = /^sav-(.+)$/.exec(k); if (!m) return;
      snaps.push('snap-prev:' + m[1], 'snap-kept:' + m[1]);
      if (!j.data['snap:' + m[1]]) snaps.push('snap:' + m[1]);
    });
    // The list of games with snapshots (so turning Resume off can delete them) keeps this device's too.
    var ids = keys.filter(function (k) { return /^snap:/.test(k); }).map(function (k) { return k.slice(5); });
    return KV.get('snap-ids').catch(function () { return null; }).then(function (mine) {
      return KV.set('snap-ids', (mine || []).concat(j.data['snap-ids'] || [], ids).filter(function (id, i, a) { return a.indexOf(id) === i; }));
    }).then(function () { return Promise.all(keys.map(function (k) { return SKIP.test(k) || k === 'snap-ids' ? null : KV.set(k, dec(j.data[k])); })
      .concat(snaps.map(function (k) { return KV.del(k).catch(function () {}); }))); })
      .then(function () { try { sessionStorage.setItem('cb-restored', summary(j)); sessionStorage.setItem('cb-reopen', 'backup'); } catch (e) {} });
  }
  function summary(j) {
    var d = j.data, saved = (d['kr-saved'] || []).length, games = Object.keys(d).filter(function (k) { return /^sav-/.test(k); }).length;
    return saved + ' saved word' + (saved === 1 ? '' : 's') + ', ' + games + ' game save' + (games === 1 ? '' : 's') +
      ', from ' + new Date(j.at).toLocaleString();
  }
  function markDone(where) { return KV.set('backup-last', { at: Date.now(), where: where }).then(render); }

  // ---------- file ----------
  function toFile() {
    return collect().then(function (j) { return gzip(JSON.stringify(j)); }).then(function (blob) {
      var name = 'cramboy-backup-' + new Date().toISOString().slice(0, 10) + '.cramboy';
      var file = new File([blob], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'CramBoy backup' }).then(function () { return markDone('file'); });
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
      return markDone('file');
    }).then(function () { toast('Backup ready', { icon: 'ok' }); })
      .catch(function (e) { if (!e || e.name !== 'AbortError') toast('Backup failed: ' + (e && e.message || e), { icon: 'info' }); });
  }
  // Restoring from the game menu: the game closes, since the app restarts to load everything.
  function restartNote() { return window.emuIsGameLoaded ? '\n\nThe game you’re playing closes and the app restarts.' : ''; }
  function fromFile(f) {
    readBackup(f).then(function (j) {
      if (!confirm('Restore this backup?\n\n' + summary(j) + '\n\nIt replaces the saved words, progress and game saves on this device.' + restartNote())) return;
      return apply(j).then(function () { location.reload(); });
    }).catch(function (e) { toast('Restore failed: ' + (e && e.message || e), { icon: 'info' }); });
  }

  // ---------- Google Drive (the app's own hidden folder in the user's Drive) ----------
  var token = null, tokenExp = 0, gisP = null;
  function loadGis() {
    if (!gisP) gisP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = res; s.onerror = function () { gisP = null; rej(new Error('Can’t reach Google. Are you online?')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  // Google's sign-in window has to open right inside the tap: iPhones (and most browsers) block a window
  // that opens later, after a script download. So Google's script and the sign-in client are loaded as soon
  // as the Backup page opens (not before: nothing is fetched from Google unless you go there), and the tap
  // only asks the ready client to open its window.
  var client = null, pending = null, connected = false;
  Promise.all([KV.get('backup-drive'), KV.get('backup-token')]).then(function (r) {
    connected = !!r[0];
    if (r[1] && r[1].exp > Date.now() + 60000 && !token) { token = r[1].t; tokenExp = r[1].exp; }
  }).catch(function () {});
  function prepare() {
    if (!GOOGLE_CLIENT_ID || client) return;
    loadGis().then(function () {
      if (client) return;
      client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: function (r) {
          var p = pending; pending = null;
          if (r.error) { if (p) p.rej(new Error(r.error_description || r.error)); return; }
          token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
          connected = true; KV.set('backup-drive', true);
          // Kept for its hour, so a restart (after restoring, or reopening the app) doesn't ask again.
          KV.set('backup-token', { t: token, exp: tokenExp }).catch(function () {});
          if (p) p.res(token);
        },
        error_callback: function (e) {
          var p = pending; pending = null;
          if (p) p.rej(new Error(e && e.type === 'popup_failed_to_open' ? 'Google’s sign-in window was blocked. Try again.' : e && e.type === 'popup_closed' ? 'Google sign-in was closed' : (e && e.message) || 'Google sign-in failed'));
        }
      });
    }).catch(function () {});
  }
  // Must be called straight from the tap (no waiting before it), so the window may open.
  function getToken(interactive) {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    if (!interactive) return Promise.reject(new Error('not signed in'));
    if (!client) { prepare(); return Promise.reject(new Error('Connecting to Google… try again in a moment.')); }
    // Connected before: Google only flashes its window and closes it by itself (no questions).
    return new Promise(function (res, rej) { pending = { res: res, rej: rej }; client.requestAccessToken(connected ? { prompt: '' } : {}); });
  }
  function api(url, o) {
    o = o || {}; o.headers = o.headers || {}; o.headers.Authorization = 'Bearer ' + token;
    return fetch(url, o).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Google Drive: ' + r.status + ' ' + t.slice(0, 120)); });
      return r;
    });
  }
  // All CramBoy backups in the app folder, newest first.
  function listFiles() {
    return api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&orderBy=modifiedTime%20desc&pageSize=50&fields=files(id,name,modifiedTime,size,appProperties)&q=' +
      encodeURIComponent("name contains '" + DRIVE_PREFIX + "'")).then(function (r) { return r.json(); })
      .then(function (j) { return (j.files || []).filter(function (f) { return f.name.indexOf(DRIVE_PREFIX) === 0; }); });
  }
  function dayKey(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // Remove all but the newest KEEP backups.
  function prune() {
    return listFiles().then(function (files) {
      return Promise.all(files.slice(KEEP).map(function (f) { return api('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'DELETE' }).catch(function () {}); }));
    });
  }
  // Resumable upload: works for any size (simple uploads stop at 5 MB).
  function upload(blob, existing, props) {
    var url = existing ? 'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=resumable'
                       : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    // appProperties: what's in it, so Restore can list the backups without downloading them.
    var meta = existing ? { appProperties: props } : { name: DRIVE_PREFIX + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json.gz', parents: ['appDataFolder'], appProperties: props };
    return api(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/gzip' }, body: JSON.stringify(meta) })
      .then(function (r) {
        var loc = r.headers.get('Location');
        if (loc) return api(loc, { method: 'PUT', body: blob });
        // The browser didn't get to see the upload address: one-request upload instead (up to 5 MB).
        var fd = new FormData();
        fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
        fd.append('file', blob);
        return api(existing ? 'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=multipart'
                            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: existing ? 'PATCH' : 'POST', body: fd });
      });
  }
  // Show on the tapped row what's happening (Google's window closes and the work takes a few seconds).
  function rowBusy(act, text) {
    var b = document.querySelector('#page-backup [data-bk="' + act + '"]'); if (!b) return;
    var label = b.querySelector('.flex-1');
    if (text) { if (!b.dataset.label) b.dataset.label = label.textContent; label.textContent = text; b.classList.add('bk-busy'); }
    else { if (b.dataset.label) label.textContent = b.dataset.label; delete b.dataset.label; b.classList.remove('bk-busy'); }
  }
  var busy = false;
  // interactive: a tap (may sign in, shows progress and a toast). o.auto: counts as the day's automatic
  // backup even so; o.quiet: no progress or toasts; o.after: wait for this first (a snapshot being stored).
  // Resolves true once it's in Drive, false if it wasn't backed up.
  function toDrive(interactive, o) {
    o = o || {};
    if (busy) return Promise.resolve(false);
    busy = true;
    var auto = !interactive || !!o.auto, ui = interactive && !o.quiet;
    var firstHere = false, signedIn = token && Date.now() < tokenExp - 60000;
    var tp = getToken(interactive);   // sign-in first, in the same tap
    if (ui) rowBusy('drive', signedIn ? 'Backing up…' : 'Signing in with Google…');
    // Whether this device was connected before is read alongside.
    return Promise.all([KV.get('backup-drive'), tp, o.after]).then(function (r0) {
      firstHere = !r0[0];
      if (ui) rowBusy('drive', 'Backing up…');
      return Promise.all([collect(), listFiles()]);
    }).then(function (r) {
      var j = r[0], d = j.data;
      var props = { saved: String((d['kr-saved'] || []).length), games: String(Object.keys(d).filter(function (k) { return /^sav-/.test(k); }).length), auto: auto ? '1' : '0' };
      // Your own backups are always new files; the automatic one updates today's automatic backup. The first
      // time on this device (another phone, or after a reinstall) always makes a new one.
      var today = auto && !firstHere && r[1].filter(function (f) { return f.appProperties && f.appProperties.auto === '1' && dayKey(f.modifiedTime) === dayKey(Date.now()); })[0];
      return gzip(JSON.stringify(j)).then(function (blob) { return upload(blob, today || null, props); });
    })
      .then(prune)
      .then(function () { busy = false; rowBusy('drive'); return markDone('drive'); })
      .then(function () { if (ui) toast('Backed up to Google Drive', { icon: 'ok' }); return true; })
      .catch(function (e) { busy = false; rowBusy('drive'); render(); if (ui && !(e && e.quiet)) toast((e && e.message) || 'Backup failed', { icon: 'info' }); return false; });
  }
  // Restore: list the backups in Drive and let the user pick one (newest first).
  function setPick(open) {
    document.getElementById('drive-pick').hidden = !open;
    document.getElementById('drive-pick-chev').style.transform = open ? 'rotate(90deg)' : '';
  }
  function fromDrive() {
    if (!document.getElementById('drive-pick').hidden) return setPick(false);   // tap again: close the list
    var signedIn = token && Date.now() < tokenExp - 60000;
    var tp = getToken(true);
    rowBusy('drive-restore', signedIn ? 'Getting your backups…' : 'Signing in with Google…');
    tp.then(function () { rowBusy('drive-restore', 'Getting your backups…'); render(); return listFiles(); }).then(function (files) {
      rowBusy('drive-restore');
      if (!files.length) throw new Error('No CramBoy backup in this Google Drive yet.');
      showPicker(files.slice(0, KEEP));
    }).catch(function (e) { rowBusy('drive-restore'); toast((e && e.message) || 'Restore failed', { icon: 'info' }); });
  }
  function whenText(t) {
    var d = new Date(t), now = new Date(), hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (dayKey(d) === dayKey(now)) return 'Today ' + hm;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(y)) return 'Yesterday ' + hm;
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
  }
  function showPicker(files) {
    var box = document.getElementById('drive-pick'), list = document.getElementById('drive-pick-list');
    list.innerHTML = '';
    files.forEach(function (f) {
      var p = f.appProperties || {}, n = +p.saved, g = +p.games;
      var sub = p.saved != null ? (n === 1 ? '1 saved word' : n + ' saved words') + ' · ' + (g === 1 ? '1 game save' : g + ' game saves') : Math.max(1, Math.round((+f.size || 0) / 1024)) + ' KB';
      if (p.auto === '1') sub += ' · automatic';
      var b = document.createElement('button');
      b.className = 'flex w-full items-center gap-2 py-2.5 pr-4 text-left active:bg-zinc-100 dark:active:bg-zinc-800'; b.style.paddingLeft = '44px';   // lines up with the row's label
      b.innerHTML = '<span class="min-w-0 flex-1"><span class="block"></span><span class="block text-sm text-zinc-500 dark:text-zinc-400"></span></span>' +
        '<span class="hi-chev text-zinc-300 dark:text-zinc-600"></span>';
      b.querySelector('.block').textContent = whenText(f.modifiedTime);
      b.querySelector('.text-sm').textContent = sub;
      if (window.HI) b.querySelector('.hi-chev').outerHTML = HI('chevron-right', 'size-5 shrink-0 text-zinc-300 dark:text-zinc-600');
      b.onclick = function () { restoreFile(f, b); };
      list.appendChild(b);
    });
    setPick(true);
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function restoreFile(f, row) {
    var label = row.querySelector('.text-sm'), was = label.textContent;
    label.textContent = 'Getting this backup…';
    api('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media').then(function (r) { return r.blob(); }).then(readBackup).then(function (j) {
      label.textContent = was;
      if (!confirm('Restore the backup from ' + whenText(f.modifiedTime) + '?\n\n' + summary(j) + '\n\nIt replaces the saved words, progress and game saves on this device.' + restartNote())) return;
      return apply(j).then(function () { location.reload(); });
    }).catch(function (e) { label.textContent = was; toast((e && e.message) || 'Restore failed', { icon: 'info' }); });
  }
  function disconnect() {
    if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, function () {});
    token = null; tokenExp = 0; connected = false;
    KV.del('backup-token').catch(function () {});
    KV.del('backup-drive').then(render);
    toast('Google Drive disconnected', { icon: 'info' });
  }
  // While signed in (an hour after connecting or backing up), back up quietly when you leave the app.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' || !token || Date.now() > tokenExp - 60000) return;
    KV.get('backup-last').then(function (l) { if (!l || Date.now() - l.at > 10 * 60000) toDrive(false); });
  });

  // ---------- the Backup page (and its row on the home screen) ----------
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function render() {
    var card = document.getElementById('backup'); if (!card) return;
    return Promise.all([KV.get('backup-last'), KV.get('backup-drive'), KV.get('kr-saved')]).then(function (r) {
      var last = r[0], drive = r[1], saved = (r[2] || []).length;
      var old = !last || Date.now() - last.at > 7 * 86400000;
      document.getElementById('backup-last').textContent = last ? 'Last backup ' + ago(last.at) + (last.where === 'drive' ? ' · Google Drive' : ' · file') : 'No backup yet';
      document.getElementById('backup-last').classList.toggle('text-amber-600', old && saved > 0);
      // The Backup row on the home screen: when you last backed up (orange when it's been a while).
      var sum = document.getElementById('backup-sum');
      if (sum) { sum.textContent = last ? 'Last backup ' + ago(last.at) : saved ? 'No backup yet' : 'Words, progress and game saves'; sum.classList.toggle('text-amber-600', old && saved > 0); sum.classList.toggle('dark:text-amber-400', old && saved > 0); }
      // The same in the game menu (App > Backup).
      var msum = document.getElementById('m-backup-sum');
      if (msum) { msum.textContent = sum ? sum.textContent : ''; msum.dataset.old = String(old && saved > 0); }
      document.getElementById('backup-drive').hidden = !GOOGLE_CLIENT_ID;
      document.getElementById('backup-drive-on').hidden = !drive;
      document.getElementById('backup-drive-label').textContent = drive ? 'Back up to Google Drive now' : 'Back up to Google Drive';
    });
  }
  function init() {
    var card = document.getElementById('page-backup'); if (!card) return;
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-bk]'); if (!b) return;
      var a = b.dataset.bk;
      if (a === 'file') toFile();
      if (a === 'restore-file') document.getElementById('file-backup').click();
      if (a === 'drive') toDrive(true);
      if (a === 'drive-restore') fromDrive();
      if (a === 'drive-off') disconnect();
    });
    document.getElementById('file-backup').addEventListener('change', function () { if (this.files[0]) fromFile(this.files[0]); this.value = ''; });
    render();
    // Just restored (the app restarts to load everything): say so.
    var done = null; try { done = sessionStorage.getItem('cb-restored'); sessionStorage.removeItem('cb-restored'); } catch (e) {}
    if (done) setTimeout(function () { toast('Backup restored: ' + done.replace(/, from .*$/, ''), { icon: 'ok', ms: 5000 }); }, 600);
  }
  window.CBBackup = { connected: function () { return connected && !!GOOGLE_CLIENT_ID; }, collect: collect, readBackup: readBackup, apply: apply, render: render, prepare: prepare, toFile: toFile, toDrive: toDrive };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
