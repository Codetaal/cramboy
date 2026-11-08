// DS 한국어 — frontend for desmume-wasm.
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

  // ---------- startup ----------
  window.wasmReady = function () {
    ready = true;
    $('status').textContent = '';
    $('btn-open').disabled = false;
    KV.get('rom').then(function (rom) {
      if (rom && rom.blob) {
        var b = $('btn-continue');
        b.textContent = '▶ Continue: ' + (rom.title || rom.name);
        b.hidden = false;
        b.onclick = function () { startGame(rom.blob, rom.name); };
      }
    }).catch(function () {});
  };
  KV.get('settings').then(function (s) { if (s) { settings.sound = s.sound !== false; settings.controls = s.controls === 'floating' ? 'floating' : 'below'; } }).catch(function () {});

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (isIOS && !standalone) $('ios-hint').hidden = false;
  var APP_VERSION = 'dsk-7';
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
    $('status').textContent = 'Storing ROM on this device…';
    readHeader(f).then(function (h) {
      return KV.set('rom', { blob: f, name: f.name, title: h.title }).catch(function () {
        // Storage full or refused: still play, just won't be remembered.
      }).then(function () { startGame(f, f.name); });
    });
  };

  function readHeader(blob) {
    return blob.slice(0, 0x200).arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab), id = '', title = '';
      for (var i = 0; i < 0x10; i++) id += u8[i] ? String.fromCharCode(u8[i]) : ' ';
      title = id.slice(0, 12).trim();
      return { id: id, title: title, code: id.slice(12, 16) };
    });
  }

  // ---------- load ----------
  function startGame(blob, name) {
    unlockAudio();
    if (!ready) return;
    $('status').textContent = 'Loading…';
    readHeader(blob).then(function (h) {
      gameID = h.code[0] === '#' ? name : h.id;
      gameTitle = h.title;
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
          $('status').textContent = '';
          alert(ret === -1001 ? 'This ROM is encrypted. Please use a decrypted (normal) dump.' : 'Could not load this ROM (error ' + ret + ').');
          return;
        }
        emuIsGameLoaded = true;
        $('status').textContent = '';
        showPlayer();
        msg(sav ? 'Save loaded' : 'No save yet for this game', 1500);
      }).catch(function (e) { $('status').textContent = 'Failed: ' + e; });
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
    for (var i = 0; i < e.touches.length; i++) {
      var t = e.touches[i], x = t.clientX, y = t.clientY;
      var found = false;
      for (var k in btns) if (hit(btns[k], x, y)) { keys |= 1 << KEYS[k]; found = true; }
      if (found || hit($('btn-menu'), x, y) || hit($('btn-ff'), x, y)) continue;
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
    menuLabels();
    $('menu').hidden = false;
  }
  function menuLabels() {
    document.querySelector('[data-m=sound]').textContent = 'Sound: ' + (settings.sound ? 'on' : 'off');
    document.querySelector('[data-m=controls]').textContent = 'Controls: ' + (settings.controls === 'floating' ? 'floating over screen' : 'below screens');
    var subs = window.KRSettings ? KRSettings.getSubs() : true;
    document.querySelector('[data-m=subs]').textContent = 'Subtitle bar: ' + (subs ? 'on' : 'off (tap 가 for text)');
  }
  function saveSettings() { KV.set('settings', settings).catch(function () {}); }
  function closeMenu() { $('menu').hidden = true; emuIsRunning = wasRunning || emuIsGameLoaded; }
  $('menu').addEventListener('click', function (e) {
    if (e.target === $('menu')) return closeMenu();
    var m = e.target.dataset && e.target.dataset.m;
    if (m === 'resume') closeMenu();
    if (m === 'sound') {
      settings.sound = !settings.sound; saveSettings(); menuLabels();
    }
    if (m === 'controls') {
      settings.controls = settings.controls === 'floating' ? 'below' : 'floating'; saveSettings(); layout(); menuLabels();
    }
    if (m === 'subs' && window.KRSettings) { KRSettings.setSubs(!KRSettings.getSubs()); menuLabels(); }
    if (m === 'export') exportSave();
    if (m === 'snapshot') exportSnapshot();
    if (m === 'import') $('file-save').click();
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
