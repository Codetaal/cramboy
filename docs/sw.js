// Offline cache for the app. Bump VERSION (and APP_VERSION in emu.js) whenever any file changes.
var VERSION = 'dsk-6';
var FILES = ['./', './index.html', './app.css', './kv.js', './emu.js', './manifest.json', './icon-180.png', './icon-512.png',
  './build/nds.js', './build/nds.wasm',
  './kr/ui.css', './kr/table.js', './kr/reader.js', './kr/lookup.js', './kr/ui.js', './kr/dict.json'];

self.addEventListener('install', function (e) {
  // cache: 'reload' bypasses the browser's HTTP cache, so a new version never stores old files.
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      return fetch(new Request(f, { cache: 'reload' })).then(function (r) {
        if (!r.ok) throw new Error(f + ' ' + r.status);
        return c.put(f, r);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || fetch(e.request); }));
});
