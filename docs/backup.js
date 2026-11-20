// Backup and restore: everything the app keeps on this device except the games themselves (and the
// resume snapshots, which are large and get made again). Saved words, known words, review schedule,
// flashcard screenshots, reading stats, settings and every game's in-game save.
// To a file (share sheet / download), or to the user's own Google Drive (hidden app folder).
(function () {
  'use strict';
  // Google OAuth client id for codetaal.github.io (Google Cloud console > APIs & Services > Credentials).
  // Empty: the Google Drive option is hidden.
  var GOOGLE_CLIENT_ID = '';
  var DRIVE_FILE = 'cramboy-backup.json.gz';
  // Not backed up: the games (and the list of them, which would point at games a new device doesn't have),
  // resume snapshots, and the backup's own bookkeeping.
  var SKIP = /^(rom($|:)|library$|snap|backup-)/;

  function b64(u8) { var s = '', i; for (i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // Values are JSON, strings, or binary (game saves): binary is stored as {"$b64": "..."}.
  function enc(v) {
    if (v instanceof ArrayBuffer) return { $b64: b64(new Uint8Array(v)), $ab: 1 };
    if (ArrayBuffer.isView(v)) return { $b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    return v;
  }
  function dec(v) {
    if (v && typeof v === 'object' && typeof v.$b64 === 'string') { var u = unb64(v.$b64); return v.$ab ? u.buffer : u; }
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
  function apply(j) {
    var keys = Object.keys(j.data);
    return Promise.all(keys.map(function (k) { return SKIP.test(k) ? null : KV.set(k, dec(j.data[k])); }));
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
  function fromFile(f) {
    readBackup(f).then(function (j) {
      if (!confirm('Restore this backup?\n\n' + summary(j) + '\n\nIt replaces the saved words, progress and game saves on this device.')) return;
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
  // Needs a tap (Google opens its sign-in window); within the hour after that no window is needed.
  function getToken(interactive) {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    if (!interactive) return Promise.reject(new Error('not signed in'));
    return loadGis().then(function () {
      return new Promise(function (res, rej) {
        var c = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.appdata',
          callback: function (r) {
            if (r.error) return rej(new Error(r.error_description || r.error));
            token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
            KV.set('backup-drive', true); res(token);
          },
          error_callback: function (e) { rej(new Error(e && e.message || 'Google sign-in was closed')); }
        });
        c.requestAccessToken();
      });
    });
  }
  function api(url, o) {
    o = o || {}; o.headers = o.headers || {}; o.headers.Authorization = 'Bearer ' + token;
    return fetch(url, o).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Google Drive: ' + r.status + ' ' + t.slice(0, 120)); });
      return r;
    });
  }
  function findFile() {
    return api('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime,size)&q=' +
      encodeURIComponent("name='" + DRIVE_FILE + "'")).then(function (r) { return r.json(); })
      .then(function (j) { return j.files && j.files[0] || null; });
  }
  // Resumable upload: works for any size (simple uploads stop at 5 MB).
  function upload(blob, existing) {
    var url = existing ? 'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=resumable'
                       : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    var meta = existing ? {} : { name: DRIVE_FILE, parents: ['appDataFolder'] };
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
  var busy = false;
  function toDrive(interactive) {
    if (busy) return Promise.resolve();
    busy = true;
    return getToken(interactive).then(function () {
      return Promise.all([collect().then(function (j) { return gzip(JSON.stringify(j)); }), findFile()]);
    }).then(function (r) { return upload(r[0], r[1]); })
      .then(function () { busy = false; return markDone('drive'); })
      .then(function () { if (interactive) toast('Backed up to Google Drive', { icon: 'ok' }); })
      .catch(function (e) { busy = false; if (interactive) toast((e && e.message) || 'Backup failed', { icon: 'info' }); });
  }
  function fromDrive() {
    getToken(true).then(findFile).then(function (f) {
      if (!f) throw new Error('No CramBoy backup in this Google Drive yet.');
      return api('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media').then(function (r) { return r.blob(); });
    }).then(readBackup).then(function (j) {
      if (!confirm('Restore the backup from Google Drive?\n\n' + summary(j) + '\n\nIt replaces the saved words, progress and game saves on this device.')) return;
      return apply(j).then(function () { location.reload(); });
    }).catch(function (e) { toast((e && e.message) || 'Restore failed', { icon: 'info' }); });
  }
  function disconnect() {
    if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, function () {});
    token = null; tokenExp = 0;
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
      if (sum) { sum.textContent = last ? 'Last backup ' + ago(last.at) : saved ? 'No backup yet' : 'Saved words, progress and game saves'; sum.classList.toggle('text-amber-600', old && saved > 0); sum.classList.toggle('dark:text-amber-400', old && saved > 0); }
      document.getElementById('backup-drive').hidden = !GOOGLE_CLIENT_ID;
      document.getElementById('backup-drive-on').hidden = !drive;
      document.getElementById('backup-drive-off').hidden = !!drive;
    });
  }
  function init() {
    var card = document.getElementById('backup'); if (!card) return;
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-bk]'); if (!b) return;
      var a = b.dataset.bk;
      if (a === 'file') toFile();
      if (a === 'restore-file') document.getElementById('file-backup').click();
      if (a === 'drive' || a === 'drive-connect') toDrive(true);
      if (a === 'drive-restore') fromDrive();
      if (a === 'drive-off') disconnect();
    });
    document.getElementById('file-backup').addEventListener('change', function () { if (this.files[0]) fromFile(this.files[0]); this.value = ''; });
    render();
  }
  window.CBBackup = { collect: collect, readBackup: readBackup, apply: apply, render: render, toFile: toFile, toDrive: toDrive };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
