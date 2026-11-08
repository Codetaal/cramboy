// Tiny IndexedDB key-value store (ROMs, saves, vocabulary).
(function () {
  'use strict';
  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open('ds-korean', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('kv', mode), req = fn(t.objectStore('kv'));
        t.oncomplete = function () { res(req && req.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  window.KV = {
    get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
    set: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
    del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); }
  };
  // Ask iOS/Chrome not to evict our data.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
})();
