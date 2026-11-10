// CheeseLab DS — frontend for desmume-wasm.
// Globals shared with kr/ui.js: Module, screenCanvas, emuIsRunning, emuIsGameLoaded, uiCurrentMode.
'use strict';

var Module = { print: function (s) { console.log(s); }, printErr: function (s) { console.warn(s); } };
var screenCanvas = [document.getElementById('top'), document.getElementById('bottom')];
var emuIsRunning = false, emuIsGameLoaded = false, uiCurrentMode = 'home';

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var KEYS = { right: 0, left: 1, down: 2, up: 3, select: 4, start: 5, b: 6, a: 7, y: 8, x: 9, l: 10, r: 11 };
  var FRAME_MS = 1000 / 60;

  var ready = false, gameID = '', gameTitle = '', romSize = 0;
  var ctx2d = screenCanvas.map(function (c) { return c.getContext('2d', { alpha: false }); });
  var touchKeys = 0, keyboardKeys = 0, touchDown = 0, touchX = 0, touchY = 0;
  var fastForward = false, frameNo = 0, lastT = 0, acc = 0;
  var prevSaveFlag = 0, saveDirty = false;
  var settings = { sound: true, controls: 'below' };

  var TAGLINE = 'Korean subtitles for your DS games';
  // ---------- startup ----------
  window.wasmReady = function () {
    ready = true;
    $('status').textContent = TAGLINE;
    $('btn-open').disabled = false;
    loadLibrary().then(renderLibrary).catch(function () {});
  };
  KV.get('settings').then(function (s) { if (s) { settings.sound = s.sound !== false; settings.controls = s.controls === 'floating' ? 'floating' : 'below'; } }).catch(function () {});

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (isIOS && !standalone) $('ios-hint').hidden = false;
  var APP_VERSION = 'cheeselab-19';
  $('ver').textContent = 'Version ' + APP_VERSION;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      reg.update().catch(function () {});
      // Check again whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () {}); });
    }).catch(function () {});
    // A new version finished installing: reload right away on the start screen, otherwise offer it.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (uiCurrentMode !== 'player') location.reload();
      else msg('Update ready: open ☰ → Close game to apply it', 6000);
    });
  }

  $('btn-open').onclick = function () { unlockAudio(); $('file-rom').click(); };
  $('file-rom').onchange = function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    readHeader(f).then(function (h) {
      // Check before storing, so a wrong file never ends up in the library.
      if (h.error) { $('status').textContent = TAGLINE; alert(h.error); return; }
      $('status').textContent = 'Storing game on this device…';
      return addToLibrary(f, h).then(function (entry) {
        startGame(f, f.name, entry && entry.id);
      });
    });
  };

  // ---------- game library ----------
  // KV 'library': [{id, name, title, size, icon, played}], ROM data in KV 'rom:<id>'.
  var library = [];
  function loadLibrary() {
    return KV.get('library').then(function (lib) {
      library = Array.isArray(lib) ? lib : [];
      // Older versions kept a single game under 'rom'.
      return KV.get('rom').then(function (old) {
        if (!old || !old.blob) return;
        return readHeader(old.blob).then(function (h) {
          if (!h.error) return addToLibrary(old.blob, h, old.name);
        }).then(function () { return KV.del('rom'); });
      });
    }).then(function () { return library; });
  }
  function saveLibrary() { return KV.set('library', library); }
  function addToLibrary(blob, h, name) {
    var id = h.id.trim() + '-' + blob.size;
    library = library.filter(function (e) { return e.id !== id; });
    var entry = { id: id, name: name || blob.name || h.title, title: h.banner || h.title, size: blob.size, icon: h.icon, played: Date.now() };
    library.unshift(entry);
    return KV.set('rom:' + id, blob).then(saveLibrary).then(function () { renderLibrary(); return entry; }, function () {
      library = library.filter(function (e) { return e.id !== id; });
      alert('There wasn\'t enough storage to keep this game in your list. It will still play now, but you\'ll need to open the file again next time.');
      return null;
    });
  }
  function removeFromLibrary(id) {
    library = library.filter(function (e) { return e.id !== id; });
    return KV.del('rom:' + id).then(saveLibrary).then(renderLibrary);
  }
  // Remove with a short "Undo" window; the ROM data is kept in memory until then.
  var undoTimer = null;
  function removeWithUndo(e) {
    KV.get('rom:' + e.id).then(function (blob) {
      removeFromLibrary(e.id);
      $('home-toast-text').textContent = 'Removed "' + e.title + '"';
      $('home-toast').hidden = false;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(function () { $('home-toast').hidden = true; }, 5000);
      $('home-toast-undo').onclick = function () {
        clearTimeout(undoTimer); $('home-toast').hidden = true;
        if (!blob) return;
        library.push(e);
        KV.set('rom:' + e.id, blob).then(saveLibrary).then(renderLibrary).catch(function () {});
      };
    });
  }
  function playFromLibrary(id) {
    KV.get('rom:' + id).then(function (blob) {
      if (!blob) { alert('This game\'s file is missing. Please add it again.'); return removeFromLibrary(id); }
      var e = library.filter(function (x) { return x.id === id; })[0];
      startGame(blob, e ? e.name : '', id);
    });
  }
  function ago(t) {
    var d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : new Date(t).toLocaleDateString();
  }
  function sizeText(n) { return n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  var RECENT = 3;
  function renderLibrary() {
    library.sort(function (a, b) { return b.played - a.played; });
    var recent = $('recent'), all = $('all-list');
    recent.innerHTML = ''; all.innerHTML = '';
    library.slice(0, RECENT).forEach(function (e) { recent.appendChild(gameRow(e)); });
    if (library.length > RECENT) {
      var more = document.createElement('button'); more.className = 'cell all-cell';
      more.innerHTML = '<span class="cell-text"><b>All Games</b></span><span class="count">' + library.length + '</span><span class="chev">›</span>';
      more.onclick = openAllGames;
      recent.appendChild(more);
    }
    library.forEach(function (e) { all.appendChild(gameRow(e)); });
    var has = library.length > 0;
    $('recent').hidden = $('recent-h').hidden = $('recent-f').hidden = !has;
    if (!all.children.length && !$('page-all').hidden) closeAllGames();
  }

  function gameRow(e) {
    var wrap = document.createElement('div'); wrap.className = 'swipe';
    var del = document.createElement('button'); del.className = 'swipe-del'; del.textContent = 'Remove';
    var cell = document.createElement('div'); cell.className = 'cell';
    cell.innerHTML = (e.icon ? '<img class="game-icon" alt="" src="' + e.icon + '">' : '<div class="game-icon blank">DS</div>') +
      '<div class="cell-text"><b></b><small></small></div><span class="chev">›</span>';
    cell.querySelector('b').textContent = e.title;
    cell.querySelector('small').textContent = 'Played ' + ago(e.played) + ' · ' + sizeText(e.size);
    wrap.appendChild(del); wrap.appendChild(cell);
    attachSwipe(wrap, cell, function () { unlockAudio(); playFromLibrary(e.id); }, function () { removeWithUndo(e); });
    del.onclick = function () { collapse(wrap, function () { removeWithUndo(e); }); };
    return wrap;
  }

  // iOS-style swipe: drag left to reveal "Remove"; release past the middle removes it.
  var openSwipe = null, REVEAL = 96;
  function setX(wrap, cell, x, animate) {
    wrap.classList.toggle('anim', !!animate);
    cell.style.transform = x ? 'translateX(' + x + 'px)' : '';
    wrap._x = x;
    if (x) wrap.classList.add('open');
    else setTimeout(function () { if (!wrap._x) wrap.classList.remove('open'); }, animate ? 270 : 0);
  }
  function closeOpenSwipe(except) {
    if (openSwipe && openSwipe !== except) { setX(openSwipe, openSwipe.lastChild, 0, true); openSwipe = null; }
  }
  function collapse(wrap, done) {
    var h = wrap.offsetHeight; wrap.style.height = h + 'px';
    setX(wrap, wrap.lastChild, -wrap.offsetWidth, true);
    setTimeout(function () { wrap.classList.add('removing'); wrap.style.height = '0px'; wrap.style.opacity = 0; }, 180);
    setTimeout(done, 430);
    openSwipe = null;
  }
  function attachSwipe(wrap, cell, onTap, onRemove) {
    var x0 = 0, y0 = 0, start = 0, drag = false, moved = false, id = null;
    wrap._x = 0;
    cell.addEventListener('pointerdown', function (ev) {
      id = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; start = wrap._x || 0; drag = false; moved = false;
      closeOpenSwipe(wrap);
    });
    cell.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== id) return;
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!drag) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) { drag = true; cell.setPointerCapture(id); }
        else if (Math.abs(dy) > 8) { id = null; return; }   // vertical: let the page scroll
        else return;
      }
      moved = true;
      var x = Math.min(0, start + dx);
      if (x > 0) x = 0;
      setX(wrap, cell, x, false);
    });
    function end(ev) {
      if (ev.pointerId !== id) return;
      id = null;
      if (!drag) return;
      var x = wrap._x || 0, w = wrap.offsetWidth;
      if (x < -w * 0.55) collapse(wrap, onRemove);
      else if (x < -REVEAL / 2) { setX(wrap, cell, -REVEAL, true); openSwipe = wrap; }
      else { setX(wrap, cell, 0, true); if (openSwipe === wrap) openSwipe = null; }
    }
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', end);
    cell.addEventListener('click', function () {
      if (moved) { moved = false; return; }
      if ((wrap._x || 0) !== 0) { setX(wrap, cell, 0, true); openSwipe = null; return; }
      onTap();
    });
  }
  document.addEventListener('pointerdown', function (ev) {
    if (openSwipe && !openSwipe.contains(ev.target)) closeOpenSwipe();
  });

  // All Games page (slides in from the right)
  function openAllGames() {
    var pg = $('page-all'); pg.hidden = false; pg.classList.add('off');
    requestAnimationFrame(function () { requestAnimationFrame(function () { pg.classList.remove('off'); }); });
  }
  function closeAllGames() {
    var pg = $('page-all'); pg.classList.add('off');
    setTimeout(function () { pg.hidden = true; }, 300);
  }
  $('nav-back').onclick = closeAllGames;

  function readHeader(blob) {
    return blob.slice(0, 0x200).arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab), id = '', title = '';
      for (var i = 0; i < 0x10; i++) id += u8[i] ? String.fromCharCode(u8[i]) : ' ';
      title = id.slice(0, 12).trim();
      var h = { id: id, title: title, code: id.slice(12, 16), error: checkRom(u8, blob) };
      if (h.error) return h;
      var bannerOff = u8[0x68] | (u8[0x69] << 8) | (u8[0x6A] << 16) | (u8[0x6B] << 24);
      if (!bannerOff || bannerOff + 0xA40 > blob.size) return h;
      return blob.slice(bannerOff, bannerOff + 0xA40).arrayBuffer().then(function (bb) {
        try { readBanner(new Uint8Array(bb), h); } catch (e) {}
        return h;
      });
    });
  }

  // The banner holds the game's 32x32 icon and its title in several languages.
  function readBanner(b, h) {
    var ver = b[0] | (b[1] << 8);
    function str(off) {
      var s = ''; for (var i = 0; i < 0x80; i++) { var c = b[off + i * 2] | (b[off + i * 2 + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    var t = (ver >= 3 && str(0x940).trim()) || str(0x340).trim();   // Korean title if present, else English
    if (t) { var lines = t.split('\n'); h.banner = (lines.length > 1 ? lines.slice(0, -1) : lines).join(' ').trim(); }
    var pal = [];
    for (var p = 0; p < 16; p++) {
      var c = b[0x220 + p * 2] | (b[0x221 + p * 2] << 8);
      pal.push([(c & 31) * 255 / 31, ((c >> 5) & 31) * 255 / 31, ((c >> 10) & 31) * 255 / 31]);
    }
    var cv = document.createElement('canvas'); cv.width = cv.height = 32;
    var g = cv.getContext('2d'), img = g.createImageData(32, 32);
    for (var ty = 0; ty < 4; ty++) for (var tx = 0; tx < 4; tx++) for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      var byte = b[0x20 + (ty * 4 + tx) * 32 + y * 4 + (x >> 1)], ix = (x & 1) ? byte >> 4 : byte & 15;
      var o = ((ty * 8 + y) * 32 + tx * 8 + x) * 4, col = pal[ix];
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = ix ? 255 : 0;
    }
    g.putImageData(img, 0, 0);
    h.icon = cv.toDataURL('image/png');
  }

  // Returns a message if this isn't a DS game file, else null.
  function checkRom(u8, blob) {
    var unpack = ' Unpack it first and pick the .nds file inside.\n\n' +
      'A .zip unpacks by tapping it in the Files app. A .rar needs an unpacking app (e.g. iZip).';
    if (u8[0] === 0x50 && u8[1] === 0x4B) return 'This is a ZIP archive, not a DS game.' + unpack;
    if (u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21) return 'This is a RAR archive, not a DS game.' + unpack;
    if (u8[0] === 0x37 && u8[1] === 0x7A && u8[2] === 0xBC && u8[3] === 0xAF) return 'This is a 7z archive, not a DS game.' + unpack;
    // Every DS game header has the checksum of the Nintendo logo (0xCF56) at 0x15C.
    var logoOk = u8.length >= 0x160 && (u8[0x15C] | (u8[0x15D] << 8)) === 0xCF56;
    if (!logoOk || blob.size < 0x8000) {
      return 'This doesn\'t look like a Nintendo DS game (.nds), so it wasn\'t loaded.' +
        (blob.name ? '\n\nFile: ' + blob.name : '');
    }
    return null;
  }

  // ---------- load ----------
  function startGame(blob, name, libId) {
    unlockAudio();
    if (!ready) return;
    $('status').textContent = 'Loading…';
    readHeader(blob).then(function (h) {
      if (h.error) {
        $('status').textContent = TAGLINE;
        if (libId) removeFromLibrary(libId);
        alert(h.error + '\n\nPlease open your game again with "Open ROM file…".');
        throw 'not a game';
      }
      gameID = h.code[0] === '#' ? name : h.id;
      gameTitle = h.title;
      if (libId) {
        library.forEach(function (e) { if (e.id === libId) e.played = Date.now(); });
        saveLibrary().catch(function () {});
      }
      var size = romSize = blob.size;
      var ptr = Module._prepareRomBuffer(size);
      var CH = 4 << 20, pos = 0;
      function next() {
        if (pos >= size) return Promise.resolve();
        return blob.slice(pos, pos + CH).arrayBuffer().then(function (ab) {
          Module.HEAPU8.set(new Uint8Array(ab), ptr + pos);
          pos += CH;
          $('status').textContent = 'Loading… ' + Math.min(100, Math.round(pos / size * 100)) + '%';
          return next();
        });
      }
      return next();
    }).then(function () { return KV.get('sav-' + gameID).catch(function () { return null; }); })
      .then(function (sav) {
        if (sav && sav.length) Module.HEAPU8.set(sav, Module._savGetPointer(sav.length));
        Module._savUpdateChangeFlag();
        Module._emuSetOpt(0, 1); // firmware language: English (games use their own language)
        var ret = Module._loadROM(romSize);
        if (ret !== 0) {
          $('status').textContent = TAGLINE;
          alert(ret === -1001 ? 'This ROM is encrypted. Please use a decrypted (normal) dump.' : 'Could not load this ROM (error ' + ret + ').');
          return;
        }
        emuIsGameLoaded = true;
        $('status').textContent = TAGLINE;
        showPlayer();
        msg(sav ? 'Save loaded' : 'No save yet for this game', 1500);
      }).catch(function (e) { if (e !== 'not a game') $('status').textContent = 'Failed: ' + e; });
  }

  function showPlayer() {
    $('home').hidden = true; $('player').hidden = false;
    document.body.classList.add('playing');
    uiCurrentMode = 'player';
    layout();
    emuIsRunning = true;
  }

  // ---------- main loop ----------
  function loop(t) {
    requestAnimationFrame(loop);
    if (!emuIsRunning) { lastT = t; acc = 0; return; }
    acc += Math.min(t - lastT, 100); lastT = t;
    var due = 0;
    while (acc >= FRAME_MS - 1 && due < 2) { acc -= FRAME_MS; due++; }
    if (acc > FRAME_MS * 3) acc = 0;
    if (fastForward) due *= 3;
    for (var i = 0; i < due && emuIsRunning; i++) runFrame(i === due - 1);
  }
  requestAnimationFrame(loop);

  function runFrame(draw) {
    var keys = touchKeys | keyboardKeys;
    Module._runFrame(draw ? 1 : 0, keys, touchDown, touchX, touchY);
    pumpAudio();
    if (window.krOnFrame) krOnFrame();
    if (draw) {
      var fb = Module._getSymbol(4), buf = Module.HEAPU8.buffer;
      for (var s = 0; s < 2; s++) {
        ctx2d[s].putImageData(new ImageData(new Uint8ClampedArray(buf, fb + s * 196608, 196608), 256, 192), 0, 0);
      }
    }
    if (++frameNo % 30 === 0) checkSave();
  }

  // ---------- saves ----------
  function copySave() {
    var n = Module._savGetSize();
    if (n <= 0) return null;
    var p = Module._savGetPointer(0);
    return Module.HEAPU8.slice(p, p + n);
  }
  function checkSave(force) {
    var flag = Module._savUpdateChangeFlag();
    if (flag) saveDirty = true;
    // Persist once the game has stopped writing (flag went 1 -> 0), or when forced.
    if (saveDirty && (force || (flag === 0 && prevSaveFlag === 1))) {
      var data = copySave();
      if (data) KV.set('sav-' + gameID, data).then(function () { msg('Saved ✓', 1200); }, function () { msg('Saving failed!', 3000); });
      saveDirty = false;
    }
    prevSaveFlag = flag;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && emuIsGameLoaded) checkSave(true);
  });

  // ---------- audio ----------
  var actx = null, proc = null, FIFO = 16384, fifoL = new Float32Array(FIFO), fifoR = new Float32Array(FIFO), fHead = 0, fLen = 0;
  function unlockAudio() {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC();
        proc = actx.createScriptProcessor(1024, 0, 2);
        proc.onaudioprocess = function (e) {
          var L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
          for (var i = 0; i < L.length; i++) {
            if (fLen > 0 && settings.sound) { L[i] = fifoL[fHead]; R[i] = fifoR[fHead]; fHead = (fHead + 1) % FIFO; fLen--; }
            else { L[i] = 0; R[i] = 0; }
          }
        };
        proc.connect(actx.destination);
        if (ready) Module._setSampleRate(Math.round(actx.sampleRate * 59.8261 / 60));
      }
      if (actx.state !== 'running') actx.resume();
    } catch (e) { console.warn('audio', e); }
  }
  function pumpAudio() {
    var n = Module._fillAudioBuffer(4096);
    if (!actx || fastForward) return;
    var p = Module._getSymbol(6) >> 1, s16 = new Int16Array(Module.HEAPU8.buffer);
    for (var i = 0; i < n; i++) {
      if (fLen >= FIFO) break;
      var w = (fHead + fLen) % FIFO;
      fifoL[w] = s16[p + i * 2] / 32768; fifoR[w] = s16[p + i * 2 + 1] / 32768; fLen++;
    }
    if (fLen > 6144) { fHead = (fHead + fLen - 3072) % FIFO; fLen = 3072; } // keep latency down
  }
  var _ready = window.wasmReady;
  window.wasmReady = function () { _ready(); if (actx) Module._setSampleRate(Math.round(actx.sampleRate * 59.8261 / 60)); else Module._setSampleRate(47856); };

  // ---------- layout ----------
  var btns = {}, dpadRect = null;
  Array.prototype.forEach.call(document.querySelectorAll('#controls [data-k]'), function (n) { btns[n.dataset.k] = n; });
  function place(n, x, y, w, h) { n.style.left = x + 'px'; n.style.top = y + 'px'; n.style.width = w + 'px'; n.style.height = h + 'px'; }

  function layout() {
    var W = innerWidth, H = innerHeight, ctl = $('controls'), sw, sh, top;
    var floating = settings.controls === 'floating';
    $('controls').classList.toggle('floating', floating);
    if (H >= W && floating) {
      // Screens as large as possible; semi-transparent controls float over the bottom screen.
      sh = Math.min(W * 0.75, H / 2); sw = sh * 4 / 3; top = 0;
      place(screenCanvas[0], (W - sw) / 2, top, sw, sh);
      place(screenCanvas[1], (W - sw) / 2, top + sh, sw, sh);
      var fh = Math.max(165, Math.min(230, H * 0.3));
      ctl.style.top = (H - fh) + 'px'; ctl.style.height = fh + 'px';
      ctl.style.opacity = 0.45;
    } else if (H >= W) {
      var ctrlH = Math.max(165, Math.min(240, H * 0.27));
      sh = Math.min(W * 0.75, (H - ctrlH) / 2); sw = sh * 4 / 3; top = 0;
      place(screenCanvas[0], (W - sw) / 2, top, sw, sh);
      place(screenCanvas[1], (W - sw) / 2, top + sh, sw, sh);
      ctl.style.top = (top + sh * 2) + 'px'; ctl.style.height = (H - top - sh * 2) + 'px';
      ctl.style.opacity = 1;
    } else {
      sh = Math.min(H, (W / 2) * 0.75); sw = sh * 4 / 3; top = (H - sh) / 2;
      place(screenCanvas[0], W / 2 - sw, top, sw, sh);
      place(screenCanvas[1], W / 2, top, sw, sh);
      ctl.style.top = '0px'; ctl.style.height = H + 'px';
      ctl.style.opacity = 0.6;
    }
    var C = ctl.getBoundingClientRect(), cw = C.width, ch = C.height;
    var pad = 14, topRow = 40;                         // L / R row
    var D = Math.min(ch - topRow - 10, cw * 0.34, 170);
    var cy = topRow + (ch - topRow) / 2;
    dpadRect = { x: pad, y: cy - D / 2, w: D, h: D };
    place($('dpad'), dpadRect.x, dpadRect.y, D, D);
    var b = D * 0.37, ax = cw - pad - D / 2;
    place(btns.x, ax - b / 2, cy - D / 2, b, b);
    place(btns.b, ax - b / 2, cy + D / 2 - b, b, b);
    place(btns.y, ax - D / 2, cy - b / 2, b, b);
    place(btns.a, ax + D / 2 - b, cy - b / 2, b, b);
    var pw = Math.min(84, D * 0.75), ph = 30;
    place(btns.l, pad, 4, pw, ph);
    place(btns.r, cw - pad - pw, 4, pw, ph);
    // Centre column between the D-pad and the face buttons.
    var colW = Math.min(84, cw - 2 * (pad + D) - 12), mid = cw / 2, h = 26;
    place($('btn-menu'), mid - colW / 2, 6, colW / 2 - 3, h);
    place($('btn-ff'), mid + 3, 6, colW / 2 - 3, h);
    place(btns.select, mid - colW / 2, ch - 2 * h - 18, colW, h);
    place(btns.start, mid - colW / 2, ch - h - 10, colW, h);
    if (window.krLayout) krLayout();
  }
  addEventListener('resize', function () { if (uiCurrentMode === 'player') setTimeout(layout, 50); });

  // ---------- touch input ----------
  function hit(n, x, y, slop) {
    var r = n.getBoundingClientRect(); slop = slop || 6;
    return x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;
  }
  function onTouch(e) {
    if (uiCurrentMode !== 'player') return;
    if (e.target.closest && e.target.closest('#menu')) return;
    e.preventDefault();
    unlockAudio();
    var keys = 0, td = 0, bottom = screenCanvas[1].getBoundingClientRect();
    var dp = $('dpad').getBoundingClientRect(), dpCls = '';
    var menuDown = false, ffDown = false;
    for (var i = 0; i < e.touches.length; i++) {
      var t = e.touches[i], x = t.clientX, y = t.clientY;
      var found = false;
      for (var k in btns) if (hit(btns[k], x, y)) { keys |= 1 << KEYS[k]; found = true; }
      if (hit($('btn-menu'), x, y)) { menuDown = true; continue; }
      if (hit($('btn-ff'), x, y)) { ffDown = true; continue; }
      if (found) continue;
      // D-pad: 8-way by angle from centre, with a generous area.
      var dx = x - (dp.left + dp.width / 2), dy = y - (dp.top + dp.height / 2);
      var onBottom = x >= bottom.left && x <= bottom.right && y >= bottom.top && y <= bottom.bottom;
      var zone = settings.controls === 'floating' ? 0.56 : 0.7;   // floating: stay close to the pad so the touchscreen stays usable
      if ((!onBottom || settings.controls === 'floating') && Math.abs(dx) < dp.width * zone && Math.abs(dy) < dp.height * zone && Math.hypot(dx, dy) > dp.width * 0.08) {
        var a = Math.atan2(dy, dx) * 180 / Math.PI;
        if (a > -67.5 && a < 67.5) { keys |= 1 << KEYS.right; dpCls += ' r'; }
        if (a > 112.5 || a < -112.5) { keys |= 1 << KEYS.left; dpCls += ' l'; }
        if (a > 22.5 && a < 157.5) { keys |= 1 << KEYS.down; dpCls += ' d'; }
        if (a < -22.5 && a > -157.5) { keys |= 1 << KEYS.up; dpCls += ' u'; }
        continue;
      }
      if (!td && x >= bottom.left && x <= bottom.right && y >= bottom.top && y <= bottom.bottom) {
        td = 1;
        touchX = Math.max(0, Math.min(255, Math.floor((x - bottom.left) / bottom.width * 256)));
        touchY = Math.max(0, Math.min(191, Math.floor((y - bottom.top) / bottom.height * 192)));
      }
    }
    touchKeys = keys; touchDown = td;
    $('dpad').className = dpCls;
    for (var k2 in btns) btns[k2].classList.toggle('on', !!(keys & (1 << KEYS[k2])));
    $('btn-menu').classList.toggle('on', menuDown);
    $('btn-ff').classList.toggle('on', ffDown);
    if (e.type === 'touchstart') {
      var t0 = e.changedTouches[0];
      if (hit($('btn-menu'), t0.clientX, t0.clientY)) openMenu();
      if (hit($('btn-ff'), t0.clientX, t0.clientY)) { fastForward = !fastForward; $('btn-ff').classList.toggle('active', fastForward); }
    }
  }
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) { addEventListener(t, onTouch, { passive: false }); });

  // Mouse (desktop testing): bottom screen + buttons.
  var mouseDown = false;
  function onMouse(e) {
    if (uiCurrentMode !== 'player' || (e.target.closest && e.target.closest('#menu,#kr-panel,#kr-pill,#kr-sheet'))) return;
    if (e.type === 'mousedown') { mouseDown = true; unlockAudio(); if (hit($('btn-menu'), e.clientX, e.clientY)) openMenu(); }
    if (e.type === 'mouseup') mouseDown = false;
    onTouch({ type: e.type === 'mousedown' ? 'touchstart' : 'touchmove', target: e.target, preventDefault: function () {},
      touches: mouseDown ? [{ clientX: e.clientX, clientY: e.clientY }] : [], changedTouches: [{ clientX: -999, clientY: -999 }] });
  }
  ['mousedown', 'mousemove', 'mouseup'].forEach(function (t) { addEventListener(t, onMouse); });

  // Keyboard (desktop / Bluetooth keyboard).
  var KB = { ArrowRight: 'right', ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up', Shift: 'select', Enter: 'start',
    z: 'b', x: 'a', a: 'y', s: 'x', q: 'l', w: 'r' };
  function onKey(e) {
    var k = KB[e.key] || KB[e.key.toLowerCase && e.key.toLowerCase()];
    if (!k || uiCurrentMode !== 'player') return;
    e.preventDefault();
    if (e.type === 'keydown') keyboardKeys |= 1 << KEYS[k]; else keyboardKeys &= ~(1 << KEYS[k]);
  }
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);

  // ---------- menu ----------
  var wasRunning = false;
  function openMenu() {
    wasRunning = emuIsRunning; emuIsRunning = false;
    touchKeys = 0; touchDown = 0;
    checkSave(true);
    $('menu-title').textContent = gameTitle || 'Menu';
    $('m-advanced').hidden = true; $('m-adv-chev').style.transform = '';
    menuLabels();
    $('menu').hidden = false;
  }
  function menuLabels() {
    var snd = document.querySelector('[data-m=sound]');
    snd.textContent = settings.sound ? '🔊' : '🔇'; snd.classList.toggle('off', !settings.sound);
    setSeg('controls', settings.controls);
    setSeg('subs', window.KRSettings ? KRSettings.getMode() : 'bar');
    $('m-words').textContent = window.KRSettings ? '★ ' + KRSettings.savedCount() : '';
    var st = window.KRReaderStats ? KRReaderStats() : null;
    $('m-info').innerHTML = 'Version ' + APP_VERSION + ' · ' + (gameID ? gameID.trim() : '') +
      (st ? '<br>Reader: ' + st.strings + ' strings in memory, ' + st.korean + ' Korean, ' + st.printers + ' being printed' : '') +
      '<br>The game saves automatically a few seconds after you save in‑game.' +
      '<br>Emulator: desmume‑wasm (GPL‑2.0). Character table and Pokémon names: PKHeX (GPL‑3.0). Dictionary: kengdic (MPL‑2.0).';
  }
  function setSeg(name, v) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-seg=' + name + '] button'), function (b) { b.classList.toggle('on', b.dataset.v === v); });
  }
  function saveSettings() { KV.set('settings', settings).catch(function () {}); }
  function closeMenu() { $('menu').hidden = true; emuIsRunning = wasRunning || emuIsGameLoaded; }
  $('menu').addEventListener('click', function (e) {
    if (e.target === $('menu')) return closeMenu();
    var segBtn = e.target.closest('.seg button');
    if (segBtn) {
      var seg = segBtn.parentNode.dataset.seg, v = segBtn.dataset.v;
      if (seg === 'controls') { settings.controls = v; saveSettings(); layout(); }
      if (seg === 'subs' && window.KRSettings) KRSettings.setMode(v);
      return menuLabels();
    }
    var el = e.target.closest('[data-m]'), m = el && el.dataset.m;
    if (m === 'resume') closeMenu();
    if (m === 'sound') { settings.sound = !settings.sound; saveSettings(); menuLabels(); }
    if (m === 'export') exportSave();
    if (m === 'import') $('file-save').click();
    if (m === 'words' && window.KRUI) { closeMenu(); KRUI.open('saved'); }
    if (m === 'advanced') {
      var open = $('m-advanced').hidden; $('m-advanced').hidden = !open;
      $('m-adv-chev').style.transform = open ? 'rotate(90deg)' : '';
      if (open) setTimeout(function () { $('m-advanced').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 0);
    }
    if (m === 'snapshot') exportSnapshot();
    if (m === 'home') { checkSave(true); setTimeout(function () { location.reload(); }, 300); }
  });
  ['touchstart', 'touchmove', 'touchend'].forEach(function (t) {
    $('menu').addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
  });

  function gzip(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }
  function gunzip(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); }

  // Memory snapshot for adding support for more games: 4 MB main RAM + both screens.
  // Format (gzip): "DSKSNAP1", u32 JSON length, JSON info, RAM (4 MB), screens (2 x 256x192 RGBA).
  function exportSnapshot() {
    var mem = Module._getSymbol(7), fb = Module._getSymbol(4);
    var ram = Module.HEAPU8.slice(mem, mem + (4 << 20));
    var screens = Module.HEAPU8.slice(fb, fb + 2 * 196608);
    var info = new TextEncoder().encode(JSON.stringify({
      gameID: gameID, title: gameTitle, app: APP_VERSION, time: new Date().toISOString(),
      reader: window.KRReaderStats ? KRReaderStats() : null
    }));
    var head = new Uint8Array(12);
    head.set(new TextEncoder().encode('DSKSNAP1'));
    new DataView(head.buffer).setUint32(8, info.length, true);
    var all = new Uint8Array(head.length + info.length + ram.length + screens.length), o = 0;
    [head, info, ram, screens].forEach(function (part) { all.set(part, o); o += part.length; });
    gzip(all).then(function (ab) {
      var name = 'snapshot-' + gameID.trim().replace(/[^\w-]+/g, '_') + '-' + Date.now() + '.dsksnap';
      var file = new File([ab], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] });
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    }).catch(function (e) { if (e && e.name !== 'AbortError') alert('Snapshot failed: ' + e); });
  }

  function exportSave() {
    var data = copySave();
    if (!data) return alert('No save data yet. Save in the game first.');
    gzip(data).then(function (ab) {
      var name = 'sav-' + gameID.trim().replace(/[^\w-]+/g, '_') + '.dsz';
      var file = new File([ab], name, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] });
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    }).catch(function (e) { if (e && e.name !== 'AbortError') alert('Export failed: ' + e); });
  }

  $('file-save').onchange = function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    var ext = f.name.split('.').pop().toLowerCase();
    f.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab);
      if (ext === 'dsz') return gunzip(u8).then(function (x) { return new Uint8Array(x); });
      if (ext === 'dsv') return u8;
      if (ext === 'sav') {
        // Raw save: overwrite the start of the current save so the emulator's footer stays valid.
        var cur = copySave();
        if (!cur) throw new Error('Save once in the game first, then import the .sav file.');
        if (u8.length > cur.length) throw new Error('This .sav file is larger than the game\'s save.');
        cur.set(u8, 0); return cur;
      }
      throw new Error('Use a .dsz, .sav or .dsv file.');
    }).then(function (data) {
      if (!confirm('Replace the save for ' + (gameTitle || 'this game') + '? The game will restart.')) return;
      return KV.set('sav-' + gameID, data).then(function () { location.reload(); });
    }).catch(function (e) { alert(e.message || e); });
  };

  // ---------- status message ----------
  var msgTimer = null;
  function msg(text, ms) {
    var m = $('msg'); m.textContent = text; m.hidden = false;
    clearTimeout(msgTimer); msgTimer = setTimeout(function () { m.hidden = true; }, ms || 1500);
  }
})();
