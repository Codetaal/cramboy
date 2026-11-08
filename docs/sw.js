// Offline cache for the app shell. Bump VERSION whenever any file changes.
var VERSION = 'dsk-1';
var FILES = ['./', './index.html', './app.css', './kv.js', './emu.js', './manifest.json', './icon-180.png', './icon-512.png',
  './build/nds.js', './build/nds.wasm',
  './kr/ui.css', './kr/table.js', './kr/reader.js', './kr/lookup.js', './kr/ui.js', './kr/dict.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
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
