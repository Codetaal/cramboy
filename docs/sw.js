// Offline cache for the app. Bump the version here and APP_VERSION in emu.js whenever any file changes
// (semantic versioning: patch = fixes, minor = features, major = big changes).
var VERSION = 'cramboy-v0.46.2';
var FILES = ['./', './index.html', './privacy.html', './terms.html', './tw.css', './app.css', './kv.js', './backup.js', './icons.js', './emu.js', './manifest.json', './icon-180.png', './icon-512.png', './icons/cramlab-logo-512.png',
  './build/nds.js', './build/nds.wasm',
  './kr/ui.css', './fonts/fonts.css', './kr/table.js', './kr/reader.js', './kr/lookup.js', './kr/grammar.js', './kr/ja-lookup.js', './kr/ja-grammar.js', './kr/ui.js', './kr/dict.json', './kr/ko-pos.json', './kr/ko-forms.json', './kr/ko-common.json'];
// Downloaded only when first needed (Japanese games), then kept for offline use.
var ON_DEMAND = ['kr/ja-dict.json'];

self.addEventListener('install', function (e) {
  // cache: 'no-store' bypasses the browser's HTTP cache, and the ?v= query bypasses GitHub Pages' own
  // server cache (it keeps files for ~10 minutes, so quick releases could otherwise mix in an older
  // file). The file is stored under its plain name.
  // Unchanged files aren't downloaded again: the request carries the ETag of the copy from the previous
  // version, and when the server answers 304 Not Modified that copy is kept. A release then fetches only
  // what changed (a few hundred KB) instead of everything (~5 MB, mostly the dictionary and the emulator).
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      var url = f + (f.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(VERSION);
      return caches.match(f).catch(function () { return null; }).then(function (old) {
        var tag = old && old.headers.get('etag');
        var get = function () {
          return fetch(new Request(url, { cache: 'no-store', headers: tag ? { 'If-None-Match': tag } : {} })).then(function (r) {
            if (r.status === 304 && old) return old;
            if (!r.ok) throw new Error(f + ' ' + r.status);
            return r;
          });
        };
        // One retry per file: on a phone a single dropped request shouldn't throw the whole update away.
        return get().catch(function () { return new Promise(function (ok) { setTimeout(ok, 1500); }).then(get); })
          .then(function (r) { return c.put(f, r); });
      });
    }).concat([keepExtras(c)]));
  }).then(function () { return self.skipWaiting(); }));
});
// Files fetched when first needed (the Japanese dictionary, subtitle fonts) come along to the new version
// too, checked the same way, so an update doesn't make you download them again. If the check fails
// (offline), the old copy is kept.
function keepExtras(c) {
  return caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) {
      return caches.open(k).then(function (old) {
        return old.keys().then(function (reqs) {
          return Promise.all(reqs.filter(function (q) { return isExtra(new URL(q.url).pathname); }).map(function (q) {
            return old.match(q).then(function (res) {
              var tag = res.headers.get('etag');
              return fetch(new Request(q.url, { cache: 'no-store', headers: tag ? { 'If-None-Match': tag } : {} }))
                .then(function (r) { return r.ok ? r : res; }, function () { return res; })
                .then(function (r) { return c.put(q, r); });
            });
          }));
        });
      });
    }));
  }).catch(function () {});
}
function isExtra(path) {
  return ON_DEMAND.some(function (f) { return path.slice(-f.length) === f; }) || /\/fonts\/.+\.woff2$/.test(path);
}
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) {
    if (r) return r;
    return fetch(e.request).then(function (res) {
      var path = new URL(e.request.url).pathname;
      // (subtitle font files too: downloaded when you pick that font, then kept)
      if (res.ok && isExtra(path)) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    });
  }));
});
