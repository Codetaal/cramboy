// Korean subtitle + vocabulary overlay for CramBoy.
// Hooks: app.js calls krOnFrame() after each emulated frame and krLayout() after layout changes.
(function () {
  'use strict';

  var SCAN_EVERY = 8;          // frames between RAM scans (~7 per second)
  var HIDE_AFTER_MS = 3500;    // hide subtitles this long after the dialogue box closes

  var BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^/]*$/, '') : 'kr/';
  var reader = new KRReader(window.KR_TABLE);
  // Storage: the app's IndexedDB helper (kv.js) when present, otherwise localForage.
  var store = window.KV ? {
    getItem: function (k) { return KV.get('kr-' + k); },
    setItem: function (k, v) { return KV.set('kr-' + k, v); },
    removeItem: function (k) { return KV.del('kr-' + k); }
  } : window.localforage ? localforage.createInstance({ name: 'kr-vocab' }) : null;
  // lang: the game's language, set by the app when a game loads ('ko' Korean, 'ja' Japanese).
  var lang = 'ko', dicts = {}, dictLoading = {};
  var LANG = {
    ko: { file: 'dict.json', dictName: 'Naver', dictUrl: 'https://korean.dict.naver.com/koendict/#/search?query=' },
    ja: { file: 'ja-dict.json', dictName: 'Jisho', dictUrl: 'https://jisho.org/search/' }
  };
  var saved = [];             // [{w, base, gloss, s, t}]
  var history = [];           // finished dialogue messages (newest last)
  // mode: always 'box', the Pokémon-style box over the game's own text (the 'bar' and 'off' choices were
  // removed in 0.23.2; no subtitles at all = Study mode off). The bar code below is no longer reachable.
  // study: false hides everything Korean-related (subtitles, translate button, word sheets) and stops reading.
  var settings = { mode: 'box', frame: 'classic', study: true, debug: /krdebug/.test(location.search) };
  var FRAMES = ['classic', 'ball', 'ocean', 'night', 'sakura'];
  var frame = 0, views = null, hideTimer = null, current = null;

  // ---------- DOM ----------
  var panel = el('div', { id: 'kr-panel', className: 'kr-hidden' });
  var textBox = el('div', { className: 'kr-text' });
  panel.appendChild(textBox);
  var pill = el('button', { id: 'kr-pill', ariaLabel: 'Words', innerHTML: HI('academic-cap') });
  var box = el('div', { id: 'kr-box', className: 'kr-hidden' });
  var boxText = el('div', { className: 'kr-box-text' });
  var boxArrow = el('div', { className: 'kr-box-arrow' });
  var boxGrip = el('div', { className: 'kr-box-grip', ariaLabel: 'Move subtitle box' });
  var boxSize = el('div', { className: 'kr-box-size', ariaLabel: 'Resize subtitle box' });
  // Scroll hint: a small caret in the top corner when there's earlier text above.
  var boxUp = el('div', { className: 'kr-box-up', ariaHidden: 'true' });
  box.appendChild(boxText); box.appendChild(boxArrow); box.appendChild(boxUp); box.appendChild(boxGrip); box.appendChild(boxSize);
  // User-placed box per orientation, in DS pixels relative to the top screen's top-left.
  var boxGeo = {};
  var BOX_DEFAULT = { x: 0, y: 142, w: 256, h: 50 };
  var sheet = el('div', { id: 'kr-sheet', className: 'fixed inset-0 z-30 flex flex-col justify-end bg-black/40', hidden: true });
  var card = el('div', { className: 'kr-card h-[var(--sheet-h,auto)] max-h-[var(--sheet-max,92vh)] flex flex-col [&>*]:shrink-0 overflow-y-auto rounded-t-3xl bg-zinc-50 px-4 text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-white' });
  // Tailwind class sets for the sheets
  var C = {
    btn: 'flex items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2.5 font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-900/5 active:scale-[0.98] dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10',
    primary: 'flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white shadow-sm active:scale-[0.98] active:bg-violet-500',
    secondary: 'flex w-full items-center justify-center gap-2 rounded-xl bg-violet-100 px-4 py-3 font-semibold text-violet-800 active:scale-[0.98] active:bg-violet-200 dark:bg-violet-400/15 dark:text-violet-200 dark:active:bg-violet-400/25',
    saved: 'flex items-center gap-1.5 rounded-xl bg-violet-100 px-3.5 py-2 font-semibold text-violet-900 ring-1 ring-violet-300 active:scale-95 dark:bg-violet-600/15 dark:text-violet-300 dark:ring-violet-400/30',
    save: 'flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 font-semibold text-white shadow-sm active:scale-95',
    card: 'rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/10',
    list: 'divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10',
    muted: 'text-sm text-zinc-500 dark:text-zinc-400',
    badge: 'ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    tab: 'flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold text-zinc-500 aria-pressed:bg-white aria-pressed:text-zinc-900 aria-pressed:shadow-sm dark:text-zinc-400 dark:aria-pressed:bg-zinc-700 dark:aria-pressed:text-white',
    mark: 'rounded-md bg-violet-200 px-1 font-semibold text-violet-900 ring-1 ring-violet-300 dark:bg-violet-500/40 dark:text-white dark:ring-violet-400/50',
  };
  card.setAttribute('data-swipe-pane', '');   // swipe from the left edge = the back button (emu.js)
  var swipePrev = null;
  card.swipeUnder = function () { return swipePrev && !swipePrev.full && !sheet.classList.contains('kr-full') ? swipePrev : null; };
  sheet.appendChild(card);

  function mount() {
    var player = document.getElementById('player') || document.body;
    player.appendChild(panel); player.appendChild(box); player.appendChild(pill);
    document.body.appendChild(sheet);
    // The emulator's window-level touch handler swallows every touch while the game runs.
    // Stop our touches from reaching it so taps and scrolling work here.
    [panel, box, pill, sheet].forEach(shield);
    textBox.addEventListener('click', onWordTap);
    boxText.addEventListener('click', onWordTap);
    dragBox(boxGrip, 'move'); dragBox(boxSize, 'size');
    pill.addEventListener('click', function () { openPage('now', 'game'); });
    // Press feedback like the other controls: quick shrink and purple tint, springing back on release.
    // (While it is purple because text is on screen it keeps its own look.)
    var releaseTimer = null;
    ['touchstart', 'mousedown'].forEach(function (t) {
      pill.addEventListener(t, function () { clearTimeout(releaseTimer); pill.classList.remove('kr-release'); pill.classList.add('kr-press'); }, { passive: true });
    });
    ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(function (t) {
      pill.addEventListener(t, function () {
        if (!pill.classList.contains('kr-press')) return;
        pill.classList.remove('kr-press'); pill.classList.add('kr-release');
        releaseTimer = setTimeout(function () { pill.classList.remove('kr-release'); }, 220);
      }, { passive: true });
    });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    krLayout();
  }

  // The emulator's window-level touch handler swallows every touch while the game runs (no clicks follow
  // on phones). Elements of ours that take taps keep their touches to themselves.
  function shield(n) {
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
      n.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });
    n.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  }
  function el(tag, props) { var n = document.createElement(tag); for (var k in props) n[k] = props[k]; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function plain(s) { return s.replace(/​/g, '').replace(/·+/g, '…'); }

  // ---------- storage ----------
  function setMode(m) {
    settings.mode = 'box';
    saveSettings();
    renderPanel();
  }
  function saveSettings() {
    if (store) store.setItem('settings', { mode: settings.mode, box: boxGeo, study: settings.study, frame: settings.frame, font: settings.font, newPerDay: settings.newPerDay, reviewsPerDay: settings.reviewsPerDay }).catch(function () {});
  }
  function setStudy(on) {
    settings.study = !!on;
    saveSettings();
    applyStudy();
  }
  function applyStudy() {
    pill.hidden = !settings.study;
    if (!settings.study) {
      current = null;
      setPanelVisible(false); box.classList.add('kr-hidden');
      if (!sheet.hidden) closeSheet(true);   // back to Settings when the Study page came from there
    }
    renderPanel();
  }
  // Subtitle font: gothic (the phone's own, Apple SD Gothic Neo), serif (Nanum Myeongjo) or pixel (Galmuri).
  var FONTS = { gothic: 'Gothic', serif: 'Serif', pixel: 'Pixel' };
  function setFont(f) {
    settings.font = FONTS[f] ? f : 'gothic';
    box.dataset.font = settings.font;
    saveSettings();
  }
  function setFrame(f) {
    settings.frame = FRAMES.indexOf(f) >= 0 ? f : 'classic';
    box.dataset.frame = settings.frame;
    saveSettings();
  }
  function resetBox() { boxGeo = {}; saveSettings(); krLayout(); toast('Subtitle box reset', 'ok'); }
  window.KRReaderStats = function () { return reader.stats; };
  window.KRSettings = { getMode: function () { return settings.mode; }, setMode: setMode, savedCount: function () { return saved.length; }, voiceName: function () { var v = bestVoice(lang); return v ? v.name + (/premium/i.test(v.name + v.voiceURI) ? ' (Premium)' : /enhanced/i.test(v.name + v.voiceURI) ? ' (Enhanced)' : '') : ''; }, knownPct: function () { var p = gameProgress(); return p.n ? pct(p.known, p.n) : null; }, dueCount: function () { return dueCount(); },
    getStudy: function () { return settings.study; }, setStudy: setStudy,
    getFrame: function () { return settings.frame; }, setFrame: setFrame, frames: FRAMES };
  // open(tab, from): the Study page; from 'settings' (the Study row in Settings) its back button returns there.
  window.KRUI = { open: function (tab, from) { openPage(tab || 'now', from || 'game'); }, resetBox: resetBox, fillMenuSettings: fillMenuSettings };

  function loadSaved() {
    if (!store) return;
    store.getItem('saved').then(function (v) { if (Array.isArray(v)) saved = v; updatePill(); }).catch(function () {});
    store.getItem('settings').then(function (v) {
      if (!v) return;
      // Older versions stored {subs: true/false} for the bar.
      settings.mode = 'box';
      if (v.box && typeof v.box === 'object') boxGeo = v.box;
      settings.study = v.study !== false;
      settings.frame = FRAMES.indexOf(v.frame) >= 0 ? v.frame : 'classic';
      if (v.newPerDay) settings.newPerDay = v.newPerDay;
      if (typeof v.reviewsPerDay === 'number') settings.reviewsPerDay = v.reviewsPerDay;
      box.dataset.frame = settings.frame;
      settings.font = FONTS[v.font] ? v.font : 'gothic'; box.dataset.font = settings.font;
      applyStudy();
      krLayout();
      renderPanel();
    }).catch(function () {});
  }
  function persist() {
    if (!store) return;
    store.setItem('saved', saved).catch(function () { toast('Could not save', 'warn'); });
  }
  // ---------- where you are ----------
  // The game you're playing, saved with each word. (Only character dialogue is read: no place names.)
  var game = { id: '', name: '' }, place = '';
  window.KRSetGame = function (id, name) { game = { id: String(id || '').trim(), name: String(name || '').trim() }; loadLog(); };

  // ---------- dialogue history (Study › Dialogue) ----------
  // Per game, newest first: conversations, each everything said between a dialogue box opening and
  // closing. A conversation you see again (same lines: talking to someone twice, a sign) isn't added twice;
  // it moves to the top and counts up. Stored as log:<game id> = [{ l: [lines], t: last time, at: [earlier times] }].
  var log = [], liveConv = null, logTimer = null, LOG_MAX = 300;
  function logKey() { return 'log:' + (game.id || 'unknown'); }
  function loadLog() {
    log = []; liveConv = null;
    if (!store) return;
    var key = logKey();
    store.getItem(key).then(function (v) { if (key === logKey() && Array.isArray(v)) log = v.concat(log).slice(0, LOG_MAX); }).catch(function () {});
  }
  function saveLog() {
    if (!store) return;
    if (logTimer) clearTimeout(logTimer);
    var key = logKey(), data = log;
    logTimer = setTimeout(function () { logTimer = null; store.setItem(key, data).catch(function () {}); }, 1500);
  }
  function logLine(t) {
    if (!liveConv) { liveConv = { l: [], t: Date.now(), at: [] }; log.unshift(liveConv); if (log.length > LOG_MAX) log.length = LOG_MAX; }
    if (liveConv.l[liveConv.l.length - 1] !== t) liveConv.l.push(t);
    liveConv.t = Date.now();
    saveLog();
  }
  // Leaving the app mid-conversation: keep the line on screen too (the same line isn't added twice).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden' || !current) return;
    var t = plain(current.text).trim();
    if (!t) return;
    logLine(t);
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (store) store.setItem(logKey(), log).catch(function () {});
  });
  function endConv() {
    var c = liveConv; liveConv = null;
    if (!c) return;
    var key = c.l.join('\n\n');
    for (var i = 0; i < log.length; i++) {
      var o = log[i];
      if (o === c || o.l.join('\n\n') !== key) continue;
      // Seen before: keep one, on top, with the earlier time added.
      log.splice(log.indexOf(c), 1);
      log.splice(log.indexOf(o), 1);
      o.at = (o.at || []).concat(o.t).slice(-20); o.t = c.t;
      log.unshift(o);
      break;
    }
    saveLog();
  }
  function whereHTML(pl, gm, cls) {
    if (!pl && !gm) return '';
    return '<p class="flex items-center gap-1 ' + (cls || '') + ' text-xs text-zinc-400 dark:text-zinc-500">' + HI('map-pin', 'size-3.5 shrink-0') +
      '<span class="truncate">' + esc([pl, gm].filter(Boolean).join(' · ')) + '</span></p>';
  }

  // ---------- known words ----------
  // Words you already know lose their dotted underline in the subtitles (still tappable). Stored per
  // language, both as seen and in dictionary form, so other forms of the same word count too.
  var known = { ko: {}, ja: {} }, baseOf = new Map();
  function loadKnown() {
    if (!store) return;
    store.getItem('known').then(function (v) {
      if (v && typeof v === 'object') ['ko', 'ja'].forEach(function (l) { (v[l] || []).forEach(function (w) { known[l][w] = 1; }); });
      if (current) renderPanel();
    }).catch(function () {});
  }
  function persistKnown() {
    if (store) store.setItem('known', { ko: Object.keys(known.ko), ja: Object.keys(known.ja) }).catch(function () { toast('Could not save', 'warn'); });
  }
  // Dictionary form of a word as it appears in the text (cached; needs the dictionary).
  function baseFor(tok) {
    var key = lang + ':' + tok;
    if (baseOf.has(key)) return baseOf.get(key);
    var d = dicts[lang];
    if (!d) return '';
    var r = lang === 'ja' ? KRLookupJa.lookup(d, tok, 1) : KRLookup.lookup(d, tok, 1);
    var hits = lang === 'ja' ? r.hits : r;
    var b = hits && hits[0] && (lang !== 'ja' || r.matched === KRLookupJa.clean(tok)) ? hits[0].word : '';
    if (baseOf.size > 5000) baseOf.clear();
    baseOf.set(key, b);
    return b;
  }
  function isKnown(tok) {
    var k = known[lang], c = lang === 'ja' ? KRLookupJa.clean(tok) : KRLookup.clean(tok);
    if (k[c]) return true;
    var b = baseFor(tok);
    return !!(b && k[b]);
  }
  function wordClass(tok) { return 'kr-w' + (isSaved(tok) ? ' kr-saved' : isKnown(tok) ? ' kr-known' : ''); }

  // ---------- hear it ----------
  // The phone's own voices (Korean / Japanese are built into iPhone): offline and free.
  var VOICE_LANG = { ko: 'ko-KR', ja: 'ja-JP' };
  // The nicest voice the device offers for a language: Premium, then Enhanced, then Siri, then the
  // one chosen in the phone's settings (default), then anything but the robotic compact /
  // Eloquence voices, and only then whatever is left.
  function voiceRank(x) {
    var id = ((x.name || '') + ' ' + (x.voiceURI || '')).toLowerCase();
    if (/premium/.test(id)) return 0;
    if (/enhanced/.test(id)) return 1;
    if (/siri/.test(id)) return 2;
    if (x.default) return 3;
    if (!/eloquence|compact/.test(id)) return 4;
    return 5;
  }
  function bestVoice(sl) {
    var want = VOICE_LANG[sl], voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    var mine = voices.filter(function (x) { return x.lang && x.lang.replace('_', '-').indexOf(want) === 0; });
    if (!mine.length) mine = voices.filter(function (x) { return x.lang && x.lang.indexOf(sl) === 0; });
    return mine.sort(function (a, b) { return voiceRank(a) - voiceRank(b); })[0] || null;
  }
  // iOS fills the voice list a moment after the page loads.
  if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', function () {});
  function speak(text, l) {
    var sl = l || lang;
    text = String(text || '').replace(/[\u200B·…]+/g, ' ').trim();
    if (!text) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { toast('Speech isn’t available here', 'warn'); return; }
    var want = VOICE_LANG[sl], voices = speechSynthesis.getVoices();
    var v = bestVoice(sl);
    if (voices.length && !v) { toast('No ' + (sl === 'ja' ? 'Japanese' : 'Korean') + ' voice on this device', 'warn'); return; }
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = want; u.rate = 0.9;
    try { if (v) u.voice = v; } catch (e) {}
    speechSynthesis.speak(u);
  }
  var SPEAK_BTN = 'grid size-10 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-200 dark:text-zinc-400 dark:active:bg-zinc-800';

  function savedEntry(word) { var c = KRLookup.clean(word); for (var i = saved.length - 1; i >= 0; i--) if (saved[i].kind !== 'g' && (saved[i].w === c || saved[i].base === c)) return saved[i]; return null; }
  function isSaved(word) { var c = KRLookup.clean(word); return saved.some(function (x) { return x.kind !== 'g' && (x.w === c || x.base === c); }); }

  function loadDict(l) {
    l = l || lang;
    if (dicts[l]) return Promise.resolve(dicts[l]);
    if (!dictLoading[l]) {
      dictLoading[l] = fetch(BASE + LANG[l].file).then(function (r) { return r.json(); })
        .then(function (d) { dicts[l] = d; baseOf.clear(); if (current) renderPanel(); if (l === 'ko') loadKoPos(); return d; })   // re-split words / mark known words once the dictionary is there
        .catch(function (e) { dictLoading[l] = null; throw e; });
    }
    return dictLoading[l];
  }
  // Called by the app when a game loads: read and look up text in that game's language.
  window.KRSetLang = function (l) {
    l = l === 'ja' ? 'ja' : 'ko';
    if (l !== lang) { lang = l; reader.setLang(l); current = null; history = []; renderPanel(); }
    loadDict(l).catch(function () {});   // Japanese: needed to split text into words; Korean: to find grammar chunks
  };

  // ---------- emulator hooks ----------
  window.krOnFrame = function () {
    if (!settings.study || ++frame % SCAN_EVERY) return;
    try {
      var mem = Module._getSymbol(7);
      var buf = Module.HEAPU8.buffer;
      if (!views || views.buf !== buf || views.mem !== mem) {
        views = { buf: buf, mem: mem, u32: new Uint32Array(buf, mem, 1 << 20), u16: new Uint16Array(buf, mem, 1 << 21) };
      }
      var res = reader.scan(views.u32, views.u16);
      handleScan(res);
    } catch (e) {
      if (settings.debug) console.error('kr scan', e);
    }
  };

  // ---------- movable in-box subtitles ----------
  // Same true app size as the player layout uses (not the sometimes-stale innerWidth/innerHeight).
  function vw() { return window.viewSize ? window.viewSize() : { w: innerWidth, h: innerHeight }; }
  function screens() {
    var r = screenCanvas[0].getBoundingClientRect(), b = screenCanvas[1] && screenCanvas[1].getBoundingClientRect();
    // Orientation comes from the window itself, not from where the screens happen to be drawn:
    // right after rotating, iPhone can still report the old layout for a moment.
    return { top: r, bottom: b && b.width ? b : null, k: r.width / 256, key: vw().w > vw().h ? 'landscape' : 'portrait' };
  }
  function placeBox() {
    var s = screens(), g = boxGeo[s.key] || BOX_DEFAULT, k = s.k;
    // Never let a saved position put the box (or its grip) off screen.
    var V = vw(), bw = Math.min(g.w * k, V.w), bh = Math.min(g.h * k, V.h);
    var bl = Math.max(0, Math.min(V.w - bw, s.top.left + g.x * k)), bt = Math.max(12, Math.min(V.h - bh, s.top.top + g.y * k));
    if (bl !== s.top.left + g.x * k || bt !== s.top.top + g.y * k || bw !== g.w * k || bh !== g.h * k)
      g = { x: (bl - s.top.left) / k, y: (bt - s.top.top) / k, w: bw / k, h: bh / k };
    // Default: full width at the bottom of the top screen, starting 4 DS pixels above the
    // game's own box (y 146) so its edge line can't peek out.
    box.style.left = (s.top.left + g.x * k) + 'px'; box.style.top = (s.top.top + g.y * k) + 'px';
    box.style.width = (g.w * k) + 'px'; box.style.height = (g.h * k) + 'px';
    // Text size follows the box height (always two lines, like the game's box)...
    boxK = k * g.h / BOX_DEFAULT.h;
    fitBox();
  }
  var boxK = 1.46;
  function fitBox() {
    // ...and shrinks only when a line would be cut off at the right.
    box.style.setProperty('--k', boxK);
    for (var i = 0; i < 3 && boxText.scrollWidth > boxText.clientWidth + 1; i++) {
      var cur = parseFloat(box.style.getPropertyValue('--k'));
      box.style.setProperty('--k', cur * boxText.clientWidth / boxText.scrollWidth);
    }
    toBottom();   // the text size changed: keep the last lines in view
  }
  function dragBox(handle, kind) {
    var start = null;
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var b = box.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, l: b.left, t: b.top, w: b.width, h: b.height };
      box.classList.add('kr-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointermove', function (e) {
      if (!start) return;
      e.preventDefault();
      var s = screens(), k = s.k, V = vw(), W = V.w, H = V.h, SNAP = 12;
      var dx = e.clientX - start.x, dy = e.clientY - start.y, l = start.l, t = start.t, w = start.w, h = start.h;
      var xs = [0, W, s.top.left, s.top.right];
      if (s.bottom) xs.push(s.bottom.left, s.bottom.right);
      var snap = function (v, list) { for (var i = 0; i < list.length; i++) if (Math.abs(v - list[i]) < SNAP) return list[i]; return null; };
      if (kind === 'move') {
        l = Math.max(0, Math.min(W - w, l + dx)); t = Math.max(12, Math.min(H - h, t + dy));   // 12: keeps the grip reachable
        var sl = snap(l, xs), sr = snap(l + w, xs);
        if (sl !== null) l = sl; else if (sr !== null) l = sr - w;   // snaps left/right only
      } else {
        w = Math.max(110 * k, Math.min(W - l, w + dx)); h = Math.max(28 * k, Math.min(H - t, 120 * k, h + dy));
        var sr2 = snap(l + w, xs);
        if (sr2 !== null && sr2 - l >= 110 * k) w = sr2 - l;
      }
      boxGeo[s.key] = { x: (l - s.top.left) / k, y: (t - s.top.top) / k, w: w / k, h: h / k };
      placeBox();
    });
    var end = function () { if (!start) return; start = null; box.classList.remove('kr-dragging'); saveSettings(); };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }

  window.krLayout = function () {
    var c = window.screenCanvas && screenCanvas[0];
    if (!c) return;
    var r = c.getBoundingClientRect();
    // The bar always sits at the top of the bottom screen (below in portrait, to the right
    // in landscape), so it never covers the main screen or the translate button.
    var c2 = screenCanvas[1], r2 = c2 && c2.getBoundingClientRect();
    var pr = r2 && r2.width > 0 ? r2 : r;
    panel.style.left = pr.left + 'px'; panel.style.top = pr.top + 'px';
    panel.style.width = pr.width + 'px'; panel.style.maxHeight = '';
    // Portrait: centred in the gap between menu/fast forward and SELECT. Landscape: top-left of the top screen.
    var spot = window.krPillSpot;
    pill.classList.toggle('kr-big', !!spot);
    if (spot) {
      var ps = spot.size || 48;
      pill.style.setProperty('--pill', ps + 'px');
      pill.style.left = (spot.x - ps / 2) + 'px'; pill.style.top = (spot.y - ps / 2) + 'px';
    }
    // Landscape: in the empty band above the top screen when there is room, so it doesn't cover the L button.
    else { pill.style.left = (r.left + 6) + 'px'; pill.style.top = (r.top >= 44 ? Math.max(6, (r.top - 32) / 2) : r.top + 6) + 'px'; }
    // Both HeartGold and White draw the dialogue box on the top screen at DS pixels
    // x 4..252, y 146..190, with two 16 px text lines starting at y 152.
    var k = r.width / 256;
    // Full width, stuck to the bottom of the top screen, covering the game's box.
    placeBox();
  };

  function handleScan(res) {
    // Only character dialogue is used (res.fresh, other text on screen, is ignored).
    if (res.newMessage && current) archive(current);
    // A held message (see below) goes away at the next button press or touch.
    if (heldAt && !res.active && (window.krInputAt || 0) > heldAt) closeCurrent();
    if (res.active) {
      heldAt = 0;
      current = res.active;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (res.changed) { renderPanel(); typedAt = performance.now(); }
      if (!dicts[lang]) loadDict().catch(function () {});
    } else if (res.closed && current && !heldAt) {
      // Normally a message closes because you pressed a button after its last page was typed. If the
      // game frees it with no press since the last letter appeared (HeartGold does this with questions
      // that are answered with a choice: "어느 쪽인가를 알려주게나" + boy / girl), the text is still on
      // screen: keep the subtitle, printed in full, until the next button press or touch, or the next
      // message.
      if ((window.krInputAt || 0) <= typedAt) {
        heldAt = performance.now();
        if (current.shown < current.text.length) { current.shown = current.text.length; renderPanel(); }
      } else closeCurrent();
    }
    pill.classList.toggle('kr-live', !!current);
    if (settings.debug) pill.textContent = reader.stats.korean + '/' + reader.stats.printers;
  }

  var heldAt = 0, typedAt = 0;   // typedAt: when the subtitle last gained letters
  function closeCurrent() {
    heldAt = 0;
    if (!current) return;
    archive(current);
    endConv();
    convo = [];   // this conversation is over: the next one starts with a clean box
    current = null;
    box.classList.add('kr-hidden');   // the game's own box has closed too
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { setPanelVisible(false); hideTimer = null; }, HIDE_AFTER_MS);
  }
  // convo: the earlier messages of the conversation going on now (cleared when its dialogue box closes),
  // shown when you scroll back in the subtitle box. The Study screen keeps the full history.
  var convo = [];
  function archive(msg) {
    var t = plain(msg.text).trim();
    if (t && history[history.length - 1] !== t) { history.push(t); if (history.length > 100) history.shift(); countText(t); }
    if (t && convo[convo.length - 1] !== t) convo.push(t);
    if (t) logLine(t);
  }

  // ---------- subtitle panel ----------
  function setPanelVisible(v) {
    panel.classList.toggle('kr-hidden', !v);
  }

  // Turn text into tappable word spans.
  function wordsHTML(text) {
    if (lang === 'ja') {
      var jaWords = function (part) {
        return KRLookupJa.segment(dicts.ja || null, part).map(function (p) {
          return p.w ? '<span class="' + wordClass(p.t) + '" data-w="' + esc(p.t) + '">' + esc(p.t) + '</span>' : esc(p.t);
        }).join('');
      };
      return text.split('\n').map(function (line) {
        var out = '', pos = 0;
        grammarIn(line).forEach(function (c) {
          out += jaWords(line.slice(pos, c.start)) + '<span class="' + chunkClass(c) + '" data-w="' + esc(c.text) + '" data-g="' + esc(c.patterns.map(function (x) { return x.id; }).join(' ')) + '">' + esc(c.text) + '</span>';
          pos = c.end;
        });
        return out + jaWords(line.slice(pos));
      }).join('<br>');
    }
    // Korean: grammar patterns spanning several words ("알 수 있단다") are one chunk; the rest word by word.
    var plainWords = function (part) {
      return part.split(/( +)/).map(function (tok) {
        if (!tok.trim() || !/[가-힣]/.test(tok)) return esc(tok);
        return '<span class="' + wordClass(tok) + '" data-w="' + esc(tok) + '">' + esc(tok) + '</span>';
      }).join('');
    };
    return text.split('\n').map(function (line) {
      var out = '', pos = 0;
      grammarIn(line).forEach(function (c) {
        out += plainWords(line.slice(pos, c.start)) + '<span class="' + chunkClass(c) + '" data-w="' + esc(c.text) + '" data-g="' + esc(c.patterns.map(function (x) { return x.id; }).join(' ')) + '">' + esc(c.text) + '</span>';
        pos = c.end;
      });
      return out + plainWords(line.slice(pos));
    }).join('<br>');
  }
  // Grammar chunks in a line (Korean, once the dictionary is loaded: it checks the verb is a real verb).
  function GR(l) { return (l || lang) === 'ja' ? window.KRGrammarJa : window.KRGrammar; }
  function grammarIn(line) { var g = GR(); return g && dicts[lang] ? g.find(dicts[lang], line) : []; }
  function patternState(id, l) {
    l = l || lang;
    return known[l]['g:' + id] ? 'known' : saved.some(function (x) { return x.kind === 'g' && x.g === id && (x.lang || 'ko') === l; }) ? 'learning' : 'new';
  }
  function chunkClass(c) {
    var st = c.patterns.map(function (x) { return patternState(x.id); });
    return 'kr-w kr-g' + (st.indexOf('learning') >= 0 ? ' kr-saved' : st.every(function (x) { return x === 'known'; }) ? ' kr-known' : '');
  }

  function currentPage() {
    // Trailing breaks (White ends each message with a page break) don't start a new page yet.
    var shown = plain(current.text.slice(0, current.shown)).replace(/\n+$/, '');
    // Only the current box page: text after the last blank line.
    var pages = shown.split('\n\n');
    return pages[pages.length - 1].replace(/^\n+/, '');
  }
  function pageFinished() {
    // The game shows ▼ when the printer has reached a line/page break or the end.
    var t = current.text, i = current.shown;
    while (i < t.length && t.charAt(i) === '\u200B') i++;
    return i >= t.length || t.charAt(i) === '\n';
  }
  function renderPanel() {
    var mode = settings.study ? settings.mode : 'off';
    if (!current || mode !== 'bar') setPanelVisible(false);
    if (!current || mode !== 'box') box.classList.add('kr-hidden');
    if (!current || mode === 'off') return;
    var page = currentPage();
    if (mode === 'bar') {
      // At most two lines, like the game's own box: the last two lines typed so far.
      textBox.innerHTML = wordsHTML(page.split('\n').slice(-2).join('\n'));
      setPanelVisible(page.length > 0);
      grabPage();
      panel.scrollTop = panel.scrollHeight;
    } else {
      // The game's box holds two lines; the last two are visible. Scroll up for what came before: earlier
      // pages of this message and the last few messages (dimmed). New text scrolls back to the bottom,
      // unless you're reading back (scrolled up) during the same message.
      var same = boxText.dataset.msg === current.key;
      if (!same) readBack = false;
      var before = plain(current.text.slice(0, current.shown)).replace(/\n+$/, '').split('\n\n').slice(0, -1).map(function (pg) { return pg.replace(/^\n+/, ''); }).filter(Boolean);
      var old = convo.slice(-3).map(function (t) { return '<div class="kr-old" data-s="' + esc(t.replace(/\n+/g, ' ')) + '">' + wordsHTML(t.replace(/\n+/g, ' ')) + '</div>'; }).join('');
      var full = plain(current.text).replace(/\n+/g, ' ');
      boxText.innerHTML = old + '<div data-s="' + esc(full) + '">' + (before.length ? '<div class="kr-prev">' + wordsHTML(before.join('\n')) + '</div>' : '') + wordsHTML(page) + '</div>';
      boxText.dataset.msg = current.key;
      boxArrow.style.visibility = pageFinished() ? 'visible' : 'hidden';
      grabPage();
      box.classList.toggle('kr-hidden', page.length === 0);
      if (boxGeo[screens().key]) fitBox();
      // Only once the box is shown and sized: a hidden box can't be scrolled (after a restart the first
      // message was drawn hidden and stayed at its first line).
      toBottom();
    }
  }
  // Reading back: you scrolled up in the box yourself. Then new text doesn't pull you down (until the
  // next message, or you scroll back to the bottom).
  var readBack = false, boxTouchAt = 0;
  function toBottom() { if (!readBack) boxText.scrollTop = boxText.scrollHeight; boxHints(); }
  function boxHints() {
    box.classList.toggle('kr-more-up', boxText.scrollTop > 2);
    box.classList.toggle('kr-back', boxText.scrollTop > 2 && boxText.scrollTop + boxText.clientHeight < boxText.scrollHeight - 4);
  }
  ['touchstart', 'touchmove', 'wheel', 'mousedown'].forEach(function (t) {
    boxText.addEventListener(t, function () { boxTouchAt = performance.now(); }, { passive: true });
  });
  boxText.addEventListener('scroll', function () {
    if (performance.now() - boxTouchAt > 1500) return;   // our own scrolling, not yours
    readBack = boxText.scrollTop + boxText.clientHeight < boxText.scrollHeight - 4;
  }, { passive: true });
  boxText.addEventListener('scroll', function () { boxHints(); }, { passive: true });

  function onWordTap(e) {
    var t = e.target.closest ? e.target.closest('.kr-w') : null;
    if (!t) return;
    var holder = t.closest('[data-s]'), raw = t.getAttribute('data-w');
    var full = holder ? holder.getAttribute('data-s') : current ? plain(current.text).replace(/\n+/g, ' ') : '';
    // Only the sentence the word is in (a message can be several sentences over several pages).
    var prev = t.closest('.kr-prev');
    // hint: the two lines the game's box shows (a "page" can scroll on for many lines)
    var sentence = pickSentence(full, raw, prev ? prev.textContent : current && !t.closest('.kr-old') ? currentPage().split('\n').slice(-2).join(' ') : '');
    if (t.hasAttribute('data-g')) return openPop(raw, sentence, t, true);
    if (lang === 'ja') {
      // Japanese: look up from the tapped word to the end of the phrase, so a longer word or an
      // inflected verb that spans several pieces is still found (いって|きます -> 行く).
      for (var n = t.nextSibling; n && n.nodeType === 1 && n.classList.contains('kr-w') && !n.hasAttribute('data-g'); n = n.nextSibling) raw += n.getAttribute('data-w');
    }
    openPop(raw, sentence, t, false);
  }

  // The sentence of a message that holds this word: split at . ! ? (and 。！？), preferring the one on the
  // page that was on screen (hint). Long or unpunctuated text falls back to that page.
  function pickSentence(full, word, hint) {
    full = String(full || '').replace(/\s+/g, ' ').trim();
    if (!full || !word) return full;
    var w = String(word).replace(/\s+/g, ' ').replace(/[!?.…,]+$/, ''), sq = function (x) { return x.replace(/\s+/g, ''); };
    var parts = (full.match(/[^.!?。！？…]+[.!?。！？…]*["”’」』)]*/g) || [full]).map(function (x) { return x.trim(); }).filter(Boolean);
    var cands = parts.filter(function (x) { return x.indexOf(w) >= 0 || sq(x).indexOf(sq(w)) >= 0; });
    var h = hint ? sq(hint.replace(/\n+/g, ' ')) : '';
    var onPage = h ? cands.filter(function (x) { var q = sq(x); return h.indexOf(q.slice(0, Math.min(6, q.length))) >= 0 || q.indexOf(h.slice(0, Math.min(6, h.length))) >= 0; }) : [];
    var pick = onPage[0] || cands[cands.length - 1] || '';
    // Game text often runs on without . ! ? over several pages ("드디어 내려왔구나 조금 전까지 친구 …"): when the
    // "sentence" is much longer than the page that was on screen, the page is the better card.
    var page = hint ? hint.replace(/\s+/g, ' ').trim() : '';
    if (!pick || pick.length > 90 || (page && pick.length > page.length * 1.5 && sq(pick).indexOf(sq(page)) >= 0)) pick = page || pick || full;
    return pick;
  }

  // ---------- word popover ----------
  // Tapping a word in the subtitles opens a small bubble right above it: dictionary form, word type, a
  // one-line meaning, Learning / Known, and More for the full sheet. The game pauses while it is open.
  var pop = null, popPaused = false;
  var PARTICLE_EN = { '은': 'topic', '는': 'topic', '이': 'subject', '가': 'subject', '을': 'object', '를': 'object', '의': 'of', '에': 'at, to', '에서': 'at, from', '에는': 'at, to (topic)', '에도': 'at, to (also)', '에만': 'only at', '에서는': 'at, from (topic)', '으로는': 'with (topic)',
    '으로': 'with, toward', '로': 'with, toward', '와': 'and, with', '과': 'and, with', '도': 'also', '만': 'only', '까지': 'until', '부터': 'from', '에게': 'to (someone)',
    '한테': 'to (someone)', '처럼': 'like', '보다': 'than', '이랑': 'and, with', '랑': 'and, with', '이나': 'or', '나': 'or', '께서': 'subject (respectful)', '아': '(calling)', '야': '(calling)', '이야': 'is' };
  var TAGS = { 'Pokémon': 'Pokémon', 'move': 'move', 'item': 'item', 'place': 'place', 'ability': 'ability', 'type': 'type', 'nature': 'nature' };
  // Korean word types, tagged once with the ko-dic morphological analyzer (tools/tag_ko_pos.js). Nouns are
  // left out of the file: a dictionary word that isn't in it is a noun.
  var koPos = null, KO_POS = { x: 'expression', v: 'verb', a: 'adjective', d: 'adverb', p: 'pronoun', u: 'number', m: 'determiner', i: 'interjection' };
  function loadKoPos() {
    if (koPos) return;
    koPos = {};
    fetch(BASE + 'ko-pos.json').then(function (r) { return r.json(); }).then(function (j) {
      var m = {}; for (var t in j) j[t].split('|').forEach(function (w) { m[w] = t; }); koPos = m;
    }).catch(function () { koPos = null; });
    // Common words in everyday spoken Korean (tools/build_ko_common.js); the rest is "rare".
    fetch(BASE + 'ko-common.json').then(function (r) { return r.json(); }).then(function (j) {
      koCommon = {}; j.split('|').forEach(function (w) { koCommon[w] = 1; });
    }).catch(function () {});
    // Irregular verb forms (들으면 -> 듣다): once they're in, words are looked up again.
    fetch(BASE + 'ko-forms.json').then(function (r) { return r.json(); }).then(function (j) {
      KRLookup.setForms(j); baseOf.clear(); if (current) renderPanel();
    }).catch(function () {});
  }
  // A rare word: uncommon in the language overall (Korean: outside the most common words of everyday
  // speech; Japanese: no commonness mark in the dictionary) and not something this game keeps using
  // (read 3 times or more here). Pokémon, moves, items and places are never rare: they're the game's words.
  var koCommon = null;
  function isRare(hit, l) {
    l = l || lang;
    if (!hit || /\((Pokémon|move|item|place|ability|type|nature)\)/.test(hit.gloss || '')) return false;
    var G = seen[l].g[game.id || 'unknown'];
    if (G && (G.w[hit.word] || 0) >= 3) return false;
    if (l === 'ja') return hit.rank >= 199;
    return !!koCommon && !koCommon[hit.word] && !(koPos && koPos[hit.word] === 'x');
  }
  var RARE_CHIP = '<span class="ml-1.5 inline-block rounded-full bg-amber-100 px-1.5 py-px align-[1px] text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">Rare word</span>';
  // "썼다 = 쓰 + 었다": how a Korean verb form is built (null for other words).
  function breakdownText(word, hit, l) {
    if ((l || wlang) !== 'ko' || !hit) return '';
    var b = KRLookup.breakdown(word, hit.word);
    return b ? KRLookup.clean(word) + ' = ' + b[0] + ' + ' + b[1] : '';
  }
  // Word type: Japanese from the dictionary's own tags, Korean from the analyzer's tags (a guess while they load).
  function wordType(hit, l) {
    if (!hit) return '';
    var g = String(hit.gloss || ''), tag = /\((Pokémon|move|item|place|ability|type|nature)\)/.exec(g);
    if (tag) return TAGS[tag[1]];
    if (l === 'ja') {
      var how = hit.how ? ' · ' + hit.how : '';
      if (hit.pos === 'i') return 'i-adjective' + how;
      if (hit.pos === 's' && /^to /i.test(g)) return 'verb (する)' + how;
      if (hit.pos && /^[15k]/.test(hit.pos)) return 'verb' + how;
      return /ly(;|,|$)/.test(g.split(';')[0]) ? 'adverb' : '';
    }
    var senses = g.split(';').map(function (x) { return x.trim(); });
    var pm0 = /^particle (.+)$/.exec(hit.how || ''), withP = function (t) { return pm0 ? t + ' + ' + pm0[1] + (PARTICLE_EN[pm0[1]] ? ' (' + PARTICLE_EN[pm0[1]] + ')' : '') : t; };
    if (koPos && Object.keys(koPos).length) return withP(KO_POS[koPos[hit.word]] || (/다$/.test(hit.word) ? 'verb' : 'noun'));
    if (/다$/.test(hit.word) && senses.some(function (x) { return /^to /i.test(x); })) return senses.some(function (x) { return /^to be /i.test(x); }) && !senses.some(function (x) { return /^to (?!be )/i.test(x); }) ? 'adjective' : 'verb';
    var pm = /^particle (.+)$/.exec(hit.how || '');
    if (pm) return 'noun + ' + pm[1] + (PARTICLE_EN[pm[1]] ? ' (' + PARTICLE_EN[pm[1]] + ')' : '');
    if (/ly$/i.test(senses[0]) || /^(in|at|by|on|for|without|anyway|always|very|again|still|already|just|really|maybe)\b/i.test(senses[0])) return 'adverb';
    return 'noun';
  }
  function closePop(keepPaused) {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener('pointerdown', popOutside, true);
    Array.prototype.forEach.call(document.querySelectorAll('.kr-sel'), function (n) { n.classList.remove('kr-sel'); });
    if (popPaused && !keepPaused) { popPaused = false; resume(); }
    // Moving to another word keeps the game paused, unless no new bubble opens (the tap became a drag).
    if (keepPaused) setTimeout(function () { if (!pop && popPaused) { popPaused = false; resume(); } }, 500);
  }
  function popOutside(e) {
    if (pop && pop.contains(e.target)) return;
    var w = e.target.closest && e.target.closest('#kr-box .kr-w, #kr-panel .kr-w');
    closePop(!!w);   // tapping another word moves the bubble there (its click opens the new one)
  }
  function openPop(raw, sentence, span, isChunk) {
    closePop(true);
    if (!popPaused && sheet.hidden) { pause(); popPaused = true; }
    wlang = lang; wordBack = 'now';
    span.classList.add('kr-sel');
    pop = el('div', { id: 'kr-pop', className: 'fixed z-[60] w-[272px] rounded-2xl bg-white p-3 pl-3.5 text-zinc-900 shadow-xl ring-1 ring-black/5 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10' });
    pop.innerHTML = '<p class="' + C.muted + '">Looking up…</p>';
    shield(pop);
    document.body.appendChild(pop);
    placePop(span);
    document.addEventListener('pointerdown', popOutside, true);
    loadDict(lang).then(function (d) {
      if (!pop) return;
      if (isChunk) return fillPopGrammar(raw, sentence, span, d);
      var r = lang === 'ja' ? KRLookupJa.lookup(d, raw, 3) : null, hits = r ? r.hits : KRLookup.lookup(d, raw, 3);
      var word = r ? r.matched : KRLookup.clean(raw);
      noteLookup(hits && hits[0] ? hits[0].word : word, lang);
      fillPopWord(word, raw, sentence, span, hits);
    }).catch(function () { if (pop) pop.innerHTML = '<p class="' + C.muted + '">Dictionary not available offline yet.</p>'; });
  }
  function popButtons(st) {
    var b = function (to, label, icon, on) {
      return '<button class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ' + (st === to ? on : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200') +
        '" data-pop="' + to + '" aria-pressed="' + (st === to) + '">' + HI(icon, 'size-4') + label + '</button>';
    };
    return '<div class="mt-2.5 flex items-center gap-1.5">' + b('learning', 'Learning', 'star', 'bg-violet-600 text-white') + b('known', 'Known', 'check', 'bg-emerald-500 text-white') +
      '<button class="ml-auto flex items-center gap-0.5 py-1.5 pl-2 text-[13px] font-semibold text-violet-600 dark:text-violet-300" data-pop="more">More' + HI('chevron-right', 'size-4') + '</button></div>';
  }
  function popHead(title, from, type, built, rare) {
    return '<div class="flex items-start gap-2"><div class="min-w-0 flex-1"><p class="flex flex-wrap items-baseline gap-x-1.5"><span class="kr-selectable text-[22px] font-bold leading-tight">' + esc(title) + '</span>' +
      (from ? '<span class="text-[13px] text-zinc-500 dark:text-zinc-400">from ' + esc(from) + '</span>' : '') +
      (built ? '<span class="text-[13px] text-zinc-500 dark:text-zinc-400">' + esc(built) + '</span>' : '') + '</p>' +
      (type || rare ? '<p class="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">' + esc(type || '') + (rare ? RARE_CHIP.replace('ml-1.5', type ? 'ml-1.5' : '') : '') + '</p>' : '') + '</div>' +
      '<button class="-mr-1 -mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-100 dark:text-zinc-400 dark:active:bg-zinc-700" data-pop="say" aria-label="Hear it">' + HI('speaker-wave', 'size-5') + '</button></div>';
  }
  function fillPopWord(word, raw, sentence, span, hits) {
    var hit = hits && hits[0], base = hit ? hit.word : word;
    var draw = function () {
      var meaning = hit ? verbFirst(hit).split('; ').slice(0, 2).join('; ') : 'Not in the offline dictionary. Tap More for other dictionaries.';
      var bd = breakdownText(word, hit, lang);
      pop.innerHTML = popHead(base, bd ? '' : base !== word ? word : '', wordType(hit, lang), bd, isRare(hit, lang)) +
        (hit && hit.reading ? '<p class="text-sm text-zinc-500 dark:text-zinc-400">' + esc(hit.reading) + '</p>' : '') +
        '<p class="mt-0.5 truncate text-[15px] text-zinc-700 dark:text-zinc-200">' + esc(meaning) + '</p>' + popButtons(wordStatus(word, base));
      placePop(span);
    };
    draw();
    pop.onclick = function (e) {
      var b = e.target.closest('[data-pop]'); if (!b) return;
      var a = b.dataset.pop;
      if (a === 'say') return speak(base, lang);
      if (a === 'more') { closePop(); return showWordSheet(word, raw, sentence, hits); }
      setWordStatus(word, base, hits, sentence, wordStatus(word, base) === a ? 'new' : a);
      span = boxSpan(raw) || span; span.classList.add('kr-sel');
      draw();
    };
  }
  function fillPopGrammar(chunk, sentence, span, d) {
    var c = GR(lang) ? GR(lang).find(d, chunk)[0] : null;
    if (!c) { closePop(); return openGrammar(chunk, sentence, span); }
    var x = c.patterns[0];
    var draw = function () {
      var parts = c.verbs.slice(0, 1).map(function (v, i) { return '<b>' + esc(v) + '</b> ' + esc((c.glosses[i] || '').split(';')[0]); })
        .concat(c.patterns.map(function (p) { return '<b class="text-violet-700 dark:text-violet-300">' + esc(p.label) + '</b> ' + esc(p.en.split(',')[0]); }));
      pop.innerHTML = popHead(chunk, '', 'grammar') +
        '<p class="mt-0.5 text-[15px] leading-snug text-zinc-700 dark:text-zinc-200">' + parts.join(' <span class="text-zinc-400">+</span> ') + '</p>' + popButtons(patternState(x.id, lang));
      placePop(span);
    };
    draw();
    pop.onclick = function (e) {
      var b = e.target.closest('[data-pop]'); if (!b) return;
      var a = b.dataset.pop;
      if (a === 'say') return speak(chunk, lang);
      if (a === 'more') { closePop(); return openGrammar(chunk, sentence, null); }
      setPatternStatus(x, chunk, sentence, patternState(x.id, lang) === a ? 'new' : a);
      span = boxSpan(chunk) || span; span.classList.add('kr-sel');
      draw();
    };
  }
  // After a re-render of the subtitles, the tapped word's new element.
  function boxSpan(w) { return Array.prototype.filter.call(document.querySelectorAll('#kr-box .kr-w, #kr-panel .kr-w'), function (n) { return n.getAttribute('data-w') === w; })[0] || null; }
  // Above the word, pointing at it; below when there's no room above. Kept inside the screen.
  function placePop(span) {
    if (!pop) return;
    var r = span.getBoundingClientRect(), W = pop.offsetWidth, H = pop.offsetHeight, v = vw();
    // Vertically against the subtitle box, so the bubble never covers the other line of text.
    var holder = span.closest('#kr-box, #kr-panel'), hr = holder ? holder.getBoundingClientRect() : r;
    var left = Math.max(8, Math.min(v.w - W - 8, r.left + r.width / 2 - W / 2));
    var above = hr.top - H - 10 >= 8, top = above ? hr.top - H - 10 : hr.bottom + 10;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    var arrow = pop.querySelector('.kr-pop-arrow') || pop.appendChild(el('i', { className: 'kr-pop-arrow' }));
    arrow.className = 'kr-pop-arrow ' + (above ? 'kr-down' : 'kr-up');
    arrow.style.left = Math.max(16, Math.min(W - 16, r.left + r.width / 2 - left)) + 'px';
  }

  // ---------- pause / resume ----------
  var wasRunning = false;
  function pause() { wasRunning = !!window.emuIsRunning; window.emuIsRunning = false; }
  function resume() { if (wasRunning && window.uiCurrentMode === 'player' && window.emuIsGameLoaded) window.emuIsRunning = true; wasRunning = false; }
  var GRAB = '<div class="mx-auto mb-3 mt-2 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"></div>'; // same handle as the menu
  // Sheet header, the same as the Settings menu's (index.html): handle, a title row (title, buttons) and
  // what belongs under it (tabs), pinned at the top while the content scrolls away under a short fade.
  function SHEET_HEAD(left, title, right, below) {
    return '<div class="sticky top-0 z-10 -mx-4 bg-zinc-50 px-4 pb-1 dark:bg-zinc-950" data-sheet-head>' + GRAB +
      '<div class="flex min-h-11 items-center gap-1">' + left + '<p class="min-w-0 flex-1 truncate text-xl font-bold">' + title + '</p>' + right + '</div>' + (below || '') +
      '<div class="pointer-events-none absolute inset-x-0 top-full h-3 bg-gradient-to-b from-zinc-50 to-transparent dark:from-zinc-950" aria-hidden="true"></div></div>';
  }
  // "Back to game" stays pinned to the bottom of the sheet while the content above it scrolls.
  var BACK = '<div class="sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-zinc-50 from-70% to-zinc-50/0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 dark:from-zinc-950 dark:to-zinc-950/0">' +
    '<button class="' + C.secondary + '" data-act="close">' + HI('play', 'size-5 text-violet-500 dark:text-violet-300') + 'Back to game</button></div>';
  // The Study screen and Study settings use the game menu's Resume button at the top right instead.
  // The Study page: a full page that slides in from the right, like Backup (from the study button and from
  // Settings). Pages opened inside it (a word, Study settings, a review) stay full pages; a word looked up
  // from the subtitles still opens as a bottom sheet.
  var pageMode = false, pageFrom = 'game', openingPage = false, pageTimer = null;
  function openPage(tab, from) {
    // Still sliding out: finish that at once and open afresh.
    if (pageTimer) { clearTimeout(pageTimer); pageTimer = null; sheet.hidden = true; sheet.classList.remove('kr-page', 'kr-off', 'kr-full'); }
    if (sheet.hidden) {
      pageMode = true; pageFrom = from === 'settings' ? 'settings' : 'game';
      card.style.transition = card.style.transform = '';   // left over from a swipe back
      sheet.classList.add('kr-page', 'kr-off');
      openingPage = true; openMenu(tab); openingPage = false;
      requestAnimationFrame(function () { requestAnimationFrame(function () { sheet.classList.remove('kr-off'); }); });
    } else openMenu(tab);
  }
  var FADE_DOWN = '<div class="pointer-events-none absolute inset-x-0 top-full h-3 bg-gradient-to-b from-zinc-50 to-transparent dark:from-zinc-950" aria-hidden="true"></div>';
  var GEAR = '<button class="grid size-10 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-200 dark:text-zinc-400 dark:active:bg-zinc-800" data-act="game-menu" aria-label="Settings">' + HI('cog-6-tooth', 'size-6') + '</button>';
  function backLink(label, attrs) {
    return '<button class="-ml-2 flex items-center gap-0.5 rounded-lg px-1 py-1 text-[17px] text-violet-600 active:opacity-60 dark:text-violet-400" ' + attrs + ' data-swipe-back>' + HI('chevron-left', 'size-6') + label + '</button>';
  }
  // Page header, as on the Backup page: a bar with the back button (and the gear and Resume) that stays at
  // the top, the large title, and what belongs under it (Study's tabs), which stays pinned under the bar.
  function PAGE_HEAD(back, title, below) {
    return '<div class="sticky top-0 z-20 -mx-4 flex h-[60px] items-center gap-1 bg-zinc-50 px-4 dark:bg-zinc-950">' + (back || '') + '<div class="flex-1"></div>' +
      (pageFrom === 'game' ? GEAR : '') + RESUME + '</div>' +
      '<h1 class="text-[34px] font-bold leading-tight tracking-tight">' + title + '</h1>' +
      (below ? '<div class="sticky top-[60px] z-10 -mx-4 bg-zinc-50 px-4 pb-1 pt-2 dark:bg-zinc-950" data-sheet-head>' + below + FADE_DOWN + '</div>' : '<div data-sheet-head></div>');
  }
  var RESUME = '<button class="flex shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2.5 font-semibold text-white shadow-sm active:scale-95 active:bg-violet-500" data-act="close">' + HI('play', 'size-4') + 'Resume</button>';
  // Back to game is the secondary button everywhere else (soft lilac); solid purple is kept for real actions
  // (Start review, Show meaning, Got it).
  function openSheet(html, withBack, full) {
    if (pageTimer && !openingPage) { clearTimeout(pageTimer); pageTimer = null; sheet.hidden = true; sheet.classList.remove('kr-page', 'kr-off', 'kr-full'); }
    if (sheet.hidden) { pause(); if (!openingPage) { pageMode = false; sheet.classList.remove('kr-page', 'kr-off'); } }
    // The page before this one, drawn under the card while you swipe back (emu.js asks card.swipeUnder).
    // (A page redrawn in place, with the same back button, keeps the page under it.)
    var keep = swipePrev, oldBack = card.querySelector('[data-swipe-back]');
    swipePrev = sheet.hidden ? null : { html: card.innerHTML, y: card.scrollTop, full: sheet.classList.contains('kr-full') };
    sheet.classList.toggle('kr-full', !!full);
    // The handle on a bottom sheet; on the Study page a page without its own header (a word) starts a bit lower.
    card.innerHTML = (full || html.indexOf('data-sheet-head') >= 0 ? '' : pageMode ? '<div class="h-4"></div>' : GRAB) + html + (withBack ? BACK : '<div class="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"></div>');
    var newBack = card.querySelector('[data-swipe-back]');
    if (!sheet.hidden && oldBack && newBack && oldBack.outerHTML === newBack.outerHTML) swipePrev = keep;
    if (swipePrev && /data-loading/.test(swipePrev.html)) swipePrev = keep;   // not the "Looking up…" placeholder
    sheet.hidden = false; card.scrollTop = 0;
  }
  // Redraw the open tab after a change made on it (Know, a setting) without jumping back to the top.
  function stay(tab) { var y = card.scrollTop; openMenu(tab); card.scrollTop = y; }
  // toSettings: the Study page's back button (or study mode turned off) when it came from Settings: Settings
  // stays open under it. Otherwise closing goes back to the game, closing Settings too.
  function closeSheet(toSettings) {
    var fromSettings = pageMode && pageFrom === 'settings';
    if (pageMode) {
      // Slide out to the right, then hide (a new page opened meanwhile cancels the hide).
      sheet.classList.add('kr-off'); clearTimeout(pageTimer);
      pageTimer = setTimeout(function () { pageTimer = null; sheet.hidden = true; sheet.classList.remove('kr-page', 'kr-off', 'kr-full'); }, 300);
      pageMode = false;
    } else { sheet.hidden = true; sheet.classList.remove('kr-full'); }
    resume(); menuTab = null; review = null;
    if (fromSettings && toSettings !== true && window.emuCloseMenu) window.emuCloseMenu();
    Array.prototype.forEach.call(document.querySelectorAll('.kr-sel'), function (n) { n.classList.remove('kr-sel'); });
    if (current) renderPanel();
  }

  // ---------- every word you read ----------
  // Each finished line of dialogue and each new sign is split into words, counted by base form
  // (세계에 / 세계를 -> 세계), overall and per game. Stored as
  //   seen[lang] = { w: { base: [times read, times looked up, last sentence] }, g: { gameId: { name, n: words read, w: { base: times } } } }
  var seen = { ko: { w: {}, g: {} }, ja: { w: {}, g: {} } }, seenTimer = null, seenPending = [];
  if (store) store.getItem('seen').then(function (v) { if (v && v.ko && v.ja) { mergeSeen(v); } }).catch(function () {});
  // Counts made before the stored ones loaded are added on top.
  function mergeSeen(v) {
    ['ko', 'ja'].forEach(function (l) {
      var a = seen[l], b = v[l];
      for (var k in a.w) { var e = b.w[k] || (b.w[k] = [0, 0, '']); e[0] += a.w[k][0]; e[1] += a.w[k][1]; if (a.w[k][2]) e[2] = a.w[k][2]; }
      for (var g in a.g) {
        var G = b.g[g] || (b.g[g] = { name: a.g[g].name, n: 0, w: {} }); G.n += a.g[g].n; for (var k2 in a.g[g].w) G.w[k2] = (G.w[k2] || 0) + a.g[g].w[k2];
        if (a.g[g].p) { G.p = G.p || {}; for (var k4 in a.g[g].p) G.p[k4] = (G.p[k4] || 0) + a.g[g].p[k4]; }
      }
      if (a.p) { b.p = b.p || {}; for (var k3 in a.p) { var ep = b.p[k3] || (b.p[k3] = [0, 0, '', '']); ep[0] += a.p[k3][0]; ep[1] += a.p[k3][1]; if (a.p[k3][2]) { ep[2] = a.p[k3][2]; ep[3] = a.p[k3][3]; } } }
      seen[l] = b;
    });
  }
  function saveSeen() { if (!store || seenTimer) return; seenTimer = setTimeout(function () { seenTimer = null; store.setItem('seen', seen).catch(function () {}); }, 3000); }
  function lineWords(text) {
    if (lang === 'ja') return [].concat.apply([], text.split('\n').map(function (line) { return KRLookupJa.segment(dicts.ja || null, line).filter(function (p) { return p.w; }).map(function (p) { return p.t; }); }));
    return text.split(/\s+/).filter(function (t) { return /[가-힣]/.test(t); });
  }
  function wordKey(tok) { return baseFor(tok) || (lang === 'ja' ? KRLookupJa.clean(tok) : KRLookup.clean(tok)); }
  function countText(text) {
    if (!settings.study) return;
    // Base forms need the dictionary: wait for it.
    if (!dicts[lang]) { seenPending.push(text); if (seenPending.length === 1) loadDict().then(function () { var p = seenPending; seenPending = []; p.forEach(countText); }).catch(function () {}); return; }
    var S = seen[lang], gid = game.id || 'unknown', G = S.g[gid] || (S.g[gid] = { name: game.name, n: 0, w: {} });
    if (game.name) G.name = game.name;
    var line = text.replace(/\n+/g, ' ');
    var count = function (k) {
      var e = S.w[k] || (S.w[k] = [0, 0, '']);
      e[0]++; e[2] = line.length <= 120 ? line : e[2];
      G.w[k] = (G.w[k] || 0) + 1; G.n++;
    };
    var rest = text;
    if (GR()) {
      // Grammar: count each pattern (Progress shows them) and the verb it is built on; drop the chunk's words.
      S.p = S.p || {}; G.p = G.p || {};
      rest = text.split('\n').map(function (ln) {
        var cs = grammarIn(ln), r = '', pos = 0;
        cs.forEach(function (c) {
          c.patterns.forEach(function (x) {
            var e = S.p[x.id] || (S.p[x.id] = [0, 0, '', '']);
            e[0]++; if (line.length <= 120) { e[2] = c.text; e[3] = line; }
            G.p[x.id] = (G.p[x.id] || 0) + 1;
          });
          c.verbs.forEach(count);
          r += ln.slice(pos, c.start) + ' '; pos = c.end;
        });
        return r + ln.slice(pos);
      }).join('\n');
    }
    lineWords(rest).forEach(function (tok) {
      var k = wordKey(tok); if (!k || (GR() && (GR().FILLER[tok] || GR().FILLER[k]))) return;
      count(k);
    });
    saveSeen();
  }
  function noteLookup(base, l) {
    if (!base) return;
    var e = seen[l].w[base] || (seen[l].w[base] = [0, 0, '']);
    e[1]++; saveSeen();
  }
  // How a word stands: 'known', 'learning' (saved) or 'new'.
  function wordState(k, l) { return known[l][k] ? 'known' : saved.some(function (x) { return x.kind !== 'g' && (x.lang || 'ko') === l && (x.base === k || x.w === k); }) ? 'learning' : 'new'; }
  // For this game: share of the words read that are known / learning / new (counting every time a word was read).
  function gameProgress() {
    var G = seen[lang].g[game.id || 'unknown'];
    var r = { n: 0, uniq: 0, known: 0, learning: 0, fresh: 0, knownUniq: 0 };
    if (!G) return r;
    for (var k in G.w) {
      var c = G.w[k], st = wordState(k, lang);
      r.n += c; r.uniq++;
      if (st === 'known') { r.known += c; r.knownUniq++; } else if (st === 'learning') r.learning += c; else r.fresh += c;
    }
    return r;
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  function progressHTML() {
    var p = gameProgress(), S = seen[lang], G = S.g[game.id || 'unknown'];
    var h = '';
    if (!p.n) return h + '<p class="mt-4 ' + C.muted + '">Nothing read yet in this game. Play a bit: every line of dialogue and every sign you read is counted here.</p>';
    var kp = pct(p.known, p.n), lp = pct(p.learning, p.n), fp = Math.max(0, 100 - kp - lp);
    h += '<div class="mt-4 ' + C.card + '"><p class="text-4xl font-bold">' + kp + '%</p>' +
      '<p class="text-zinc-600 dark:text-zinc-300">of the words you read in ' + (game.name ? esc(game.name) : 'this game') + ' are words you know.</p>' +
      '<div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">' +
        '<div class="bg-emerald-500" style="width:' + kp + '%"></div><div class="bg-violet-600" style="width:' + lp + '%"></div></div>' +
      '<div class="mt-2 flex gap-3 text-xs text-zinc-500 dark:text-zinc-400">' +
        '<span class="flex items-center gap-1"><i class="size-2 rounded-full bg-emerald-500"></i>Known ' + kp + '%</span>' +
        '<span class="flex items-center gap-1"><i class="size-2 rounded-full bg-violet-600"></i>Learning ' + lp + '%</span>' +
        '<span class="flex items-center gap-1"><i class="size-2 rounded-full bg-zinc-300 dark:bg-zinc-600"></i>New ' + fp + '%</span></div>' +
      '<p class="mt-3 text-sm ' + C.muted + '">' + p.n.toLocaleString() + ' words read · ' + p.uniq.toLocaleString() + ' different · ' + p.knownUniq.toLocaleString() + ' known</p></div>';
    // Probably known: read often, never looked up.
    var filler = function (k) { return GR() && GR().FILLER[k]; };
    var likely = Object.keys(S.w).filter(function (k) { var e = S.w[k]; return e[0] >= 15 && !e[1] && wordState(k, lang) === 'new' && !filler(k); })
      .sort(function (a, b) { return S.w[b][0] - S.w[a][0]; }).slice(0, 8);
    if (likely.length) {
      h += '<div class="mt-5 flex items-end px-1"><p class="flex-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Probably known</p>' +
        '<button class="text-sm font-semibold text-zinc-600 active:opacity-60 dark:text-zinc-300" data-act="pg-know-all">Mark all as known</button></div>' +
        '<p class="mt-0.5 px-1 text-sm ' + C.muted + '">Read many times and never looked up.</p><div class="mt-1.5 ' + C.list + '">' +
        likely.map(function (k) { return progRow(k, S.w[k][0] + '× read', '<button class="' + C.btn + ' !px-3 !py-1.5 text-sm" data-know="' + esc(k) + '">' + HI('check', 'size-4') + 'Know</button>'); }).join('') + '</div>';
    }
    // Worth learning: words you keep looking up first, then the most frequent new words in this game.
    var worth = Object.keys(G ? G.w : {}).filter(function (k) { return wordState(k, lang) === 'new' && likely.indexOf(k) < 0 && !filler(k); })
      .sort(function (a, b) { var la = (S.w[a] || [0, 0])[1] >= 2, lb = (S.w[b] || [0, 0])[1] >= 2; return la !== lb ? (lb ? 1 : -1) : G.w[b] - G.w[a]; }).slice(0, 10);
    if (worth.length) {
      h += '<p class="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Worth learning</p>' +
        '<p class="mt-0.5 px-1 text-sm ' + C.muted + '">Words you keep looking up, and the most common new words in this game. Tap one to learn it.</p><div class="mt-1.5 ' + C.list + '">' +
        worth.map(function (k) { var e = S.w[k] || [0, 0]; return progRow(k, G.w[k] + '× read' + (e[1] >= 2 ? ' · looked up ' + e[1] + '×' : ''), HI('chevron-right', 'size-5 text-zinc-300 dark:text-zinc-600'), true); }).join('') + '</div>';
    }
    // Grammar: the patterns met in this game, most common first.
    var gp = G && G.p && GR() ? Object.keys(G.p).filter(function (id) { return GR().byId(id); }).sort(function (a, b) { return G.p[b] - G.p[a]; }).slice(0, 10) : [];
    if (gp.length) {
      var STATE = { known: '<span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Known</span>', learning: '<span class="text-sm font-semibold text-violet-600 dark:text-violet-300">Learning</span>', 'new': HI('chevron-right', 'size-5 text-zinc-300 dark:text-zinc-600') };
      h += SEC('Grammar in this game') + '<p class="mt-0.5 px-1 text-sm ' + C.muted + '">Patterns like ' + (lang === 'ja' ? '“〜ことができる”' : '“-(으)ㄹ 수 있다”') + ' (can). Tap one to see it in a sentence and learn it.</p><div class="mt-1.5 ' + C.list + '">' +
        gp.map(function (id) {
          var x = GR().byId(id);
          return '<div class="flex cursor-pointer items-center gap-3 px-4 py-2.5 active:bg-zinc-100 dark:active:bg-zinc-800" data-gp="' + id + '"><div class="min-w-0 flex-1"><p class="font-bold">' + esc(x.label) + '</p>' +
            '<p class="text-sm ' + C.muted + '">' + esc(x.en) + ' · ' + G.p[id] + '×</p></div>' + STATE[patternState(id)] + '</div>';
        }).join('') + '</div>';
    }
    return h;
  }
  function progRow(k, sub, right, open) {
    return '<div class="flex items-center gap-3 px-4 py-2.5' + (open ? ' cursor-pointer active:bg-zinc-100 dark:active:bg-zinc-800" data-pw="' + esc(k) + '"' : '"') + '>' +
      '<div class="min-w-0 flex-1"><p class="font-bold">' + esc(k) + '</p><p class="text-sm ' + C.muted + '">' + sub + '</p></div>' + right + '</div>';
  }
  function markKnown(keys) {
    keys.forEach(function (k) { known[lang][k] = 1; });
    persistKnown(); if (current) renderPanel();
    toast(keys.length === 1 ? 'Known: ' + keys[0] : keys.length + ' words marked as known', 'ok');
  }

  // ---------- word sheet ----------
  // Which Words & text tab the word sheet's back button returns to: the tab the word was
  // tapped in, or Now when it was tapped in the subtitles.
  var menuTab = null, wordBack = 'now', settingsBack = 'now';
  var TAB_LABEL = { now: 'Dialogue', words: 'Words', review: 'Review', progress: 'Progress', session: 'Review', settings: 'Study settings' };
  // l: the word's own language (a saved word from a game in the other language); default the game's.
  var wlang = 'ko';
  function openWord(raw, sentence, span, l) {
    wlang = l || lang;
    var word = KRLookup.clean(raw);
    if (wlang === 'ja') {
      wordBack = menuTab || 'now';
      if (span) span.classList.add('kr-sel');
      openSheet('<p class="' + C.muted + '" data-loading>Looking up…</p>');
      loadDict('ja').then(function (d) { var r = KRLookupJa.lookup(d, raw, 5); noteLookup(r.hits && r.hits[0] ? r.hits[0].word : r.matched, wlang); showWord(r.matched, r.matched, sentence, r.hits); })
        .catch(function () { showWord(KRLookupJa.clean(raw), raw, sentence, null); });
      return;
    }
    wordBack = menuTab || 'now';
    if (span) span.classList.add('kr-sel');
    openSheet('<p class="' + C.muted + '" data-loading>Looking up…</p>');
    loadDict(wlang).then(function (d) { var hits = KRLookup.lookup(d, raw, 3); noteLookup(hits && hits[0] ? hits[0].word : word, wlang); showWord(word, raw, sentence, hits); })
      .catch(function () { showWord(word, raw, sentence, null); });
  }

  // A verb's or adjective's "to …" senses first (the dictionary lists 보다 as "than; …; To see").
  function verbFirst(hit) {
    var senses = String(hit.gloss || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    var toS = senses.filter(function (x) { return /^to /i.test(x); }).sort(function (a, b) { return a.length - b.length; });
    if (/다$/.test(hit.word) && toS.length) senses = toS.concat(senses.filter(function (x) { return toS.indexOf(x) < 0; }));
    return senses.join('; ');
  }
  function showWordSheet(word, raw, sentence, hits) { wordBack = menuTab || 'now'; showWord(word, raw, sentence, hits); }
  function showWord(word, raw, sentence, hits) {
    var savedNow = isSaved(word), OUT = HI('arrow-top-right-on-square', 'size-4 text-zinc-400');
    var base = hits && hits[0] ? hits[0].word : word, knownNow = !savedNow && !!(known[wlang][word] || known[wlang][base]);
    // One status per word: New, Learning (saved to your list) or Known (no underline in the subtitles).
    var status = savedNow ? 'learning' : knownNow ? 'known' : 'new';
    var segBtn = function (st, label, icon, on) {
      return '<button class="flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold transition-colors ' + (status === st ? on : 'text-zinc-500 dark:text-zinc-400') +
        '" data-status="' + st + '" aria-pressed="' + (status === st) + '">' + (icon ? HI(icon, 'size-4') : '') + label + '</button>';
    };
    var h = '<button class="-ml-1.5 -mt-1 mb-1 flex items-center gap-0.5 py-1 pr-2 font-medium text-zinc-600 active:opacity-60 dark:text-zinc-300" data-act="back" data-swipe-back>' +
      HI('chevron-left', 'size-5') + TAB_LABEL[wordBack] + '</button>' +
      '<div class="flex items-center gap-1"><div class="kr-selectable min-w-0 break-keep text-[30px] font-bold">' + esc(word) + '</div>' +
      '<button class="' + SPEAK_BTN + '" data-act="say-word" aria-label="Hear the word">' + HI('speaker-wave', 'size-6') + '</button></div>' +
      (wordType(hits && hits[0], wlang) || isRare(hits && hits[0], wlang) ? '<p class="-mt-0.5 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">' + esc(wordType(hits && hits[0], wlang) || '') + (isRare(hits && hits[0], wlang) ? RARE_CHIP : '') + '</p>' : '') +
      (isRare(hits && hits[0], wlang) ? '<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Uncommon in everyday ' + (wlang === 'ja' ? 'Japanese' : 'Korean') + ' and rare in this game: probably not worth a flashcard.</p>' : '') +
      (breakdownText(word, hits && hits[0]) ? '<p class="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">' + esc(breakdownText(word, hits[0])) + '</p>' : '') +
      '<div class="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-800" role="group" aria-label="How well you know this word">' +
      segBtn('new', 'New', '', 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white') +
      segBtn('learning', 'Learning', 'star', 'bg-violet-600 text-white shadow-sm') +
      segBtn('known', 'Known', 'check', 'bg-emerald-500 text-white shadow-sm') + '</div>';
    if (hits === null) h += '<p class="mt-3 ' + C.muted + '">Dictionary not available offline yet. Use the links below.</p>';
    else if (!hits.length) h += '<p class="mt-3 ' + C.muted + '">Not in the offline dictionary. Try ' + LANG[wlang].dictName + ' below, or long‑press the word above → Look Up.</p>';
    else {
      h += '<div class="mt-3 ' + C.list + '">';
      hits.forEach(function (x) {
        h += '<div class="px-4 py-3"><p class="text-lg font-bold"><span class="kr-selectable">' + esc(x.word) + '</span>' +
          (x.reading ? '<span class="kr-selectable ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">' + esc(x.reading) + '</span>' : '') +
          // Korean: the type line above says it already ("verb", "noun + 를"); only flag a closest-match guess.
          (x.how && (wlang === 'ja' || x.how === 'prefix') ? '<span class="' + C.badge + '">' + esc(x.how === 'prefix' ? 'closest match' : x.how) + '</span>' : '') + '</p>' +
          '<p class="mt-0.5 text-zinc-600 dark:text-zinc-300">' + esc(verbFirst(x)) + '</p></div>';
      });
      h += '</div>';
    }
    if (sentence) {
      var marked = esc(sentence).split(esc(raw)).join('<mark class="' + C.mark + '">' + esc(raw) + '</mark>');
      h += '<div class="mt-3 flex items-start gap-1 ' + C.card + '"><p class="kr-selectable flex-1 leading-relaxed text-zinc-800 dark:text-zinc-200">' + marked + '</p>' +
        '<button class="' + SPEAK_BTN + ' -my-1.5 -mr-2" data-act="say-sentence" aria-label="Hear the sentence">' + HI('speaker-wave', 'size-5') + '</button></div>';
    }
    var where = savedNow ? savedEntry(word) : null;
    h += whereHTML(where ? where.place : place, where ? where.game : game.name, 'mt-2 px-1');
    h += '<div class="mt-3 grid ' + (sentence ? 'grid-cols-2' : 'grid-cols-1') + ' gap-2">' +
      '<a class="' + C.btn + '" target="_blank" rel="noopener" href="' + LANG[wlang].dictUrl + encodeURIComponent(base) + '">' + LANG[wlang].dictName + ' ' + OUT + '</a>' +
      (sentence ? '<a class="' + C.btn + '" target="_blank" rel="noopener" href="https://translate.google.com/?sl=' + wlang + '&tl=en&op=translate&text=' + encodeURIComponent(sentence) + '">Google ' + OUT + '</a>' : '') +
      '</div>';
    card.onclick = null;
    openSheet(h, true);
    card.querySelector('[data-act=close]').onclick = closeSheet;
    card.querySelector('[data-act=back]').onclick = function () { goBack(wordBack); };
    card.querySelector('[data-act=say-word]').onclick = function () { speak(word, wlang); };
    if (sentence) card.querySelector('[data-act=say-sentence]').onclick = function () { speak(sentence, wlang); };
    Array.prototype.forEach.call(card.querySelectorAll('[data-status]'), function (btn) {
      btn.onclick = function () {
        if (btn.dataset.status === status) return;
        setWordStatus(word, base, hits, sentence, btn.dataset.status);
        showWord(word, raw, sentence, hits);
      };
    });
  }
  // New / Learning / Known for a word (in wlang). Learning and Known exclude each other: a word you know
  // leaves your saved list, and back.
  function wordStatus(word, base) { return isSaved(word) ? 'learning' : (known[wlang][word] || known[wlang][base]) ? 'known' : 'new'; }
  function setWordStatus(word, base, hits, sentence, to) {
    var k = known[wlang];
    if (to !== 'learning' && isSaved(word)) {
      saved = saved.filter(function (x) { var hit = x.kind !== 'g' && (x.w === word || x.base === word || x.w === base || x.base === base); if (hit) dropShot(x.t); return !hit; });
      persist(); updatePill();
    }
    if (to !== 'known') { delete k[word]; delete k[base]; }
    if (to === 'learning') {
      var t = Date.now();
      saved.push({ w: word, base: base, reading: hits && hits[0] ? hits[0].reading || '' : '', gloss: hits && hits[0] ? hits[0].gloss : '', s: sentence || '', t: t, lang: wlang,
        place: place, game: game.name, due: t, iv: 0, ease: EASE, reps: 0 });
      snapshot(t, sentence);
      persist(); updatePill();
      toast('Saved: ' + base, 'star');
    } else if (to === 'known') { k[word] = 1; k[base] = 1; toast('Known: ' + base, 'ok'); }
    else toast('Marked as new: ' + base, 'info');
    persistKnown();
    if (current) renderPanel();
  }
  function setPatternStatus(x, chunk, sentence, to) {
    var id = x.id, k = known[wlang];
    saved = saved.filter(function (y) { var hit = y.kind === 'g' && y.g === id; if (hit) dropShot(y.t); return !hit; });
    delete k['g:' + id];
    if (to === 'learning') {
      var t = Date.now();
      saved.push({ kind: 'g', g: id, w: chunk || '', base: x.label, reading: '', gloss: x.en, ex: x.ex, s: sentence || '', t: t, lang: wlang,
        place: place, game: game.name, due: t, iv: 0, ease: EASE, reps: 0 });
      if (chunk) snapshot(t, sentence);
      toast('Saved: ' + x.label, 'star');
    } else if (to === 'known') { k['g:' + id] = 1; toast('Known: ' + x.label, 'ok'); }
    else toast('Marked as new: ' + x.label, 'info');
    persist(); persistKnown(); updatePill();
    if (current) renderPanel();
  }

  // ---------- grammar sheet ----------
  // A chunk like "알 수 있단다": the verb (알다), the pattern (-(으)ㄹ 수 있다 = can) and the ending (-단다),
  // each explained. Patterns can be learned like words (Learning / Known) and come back in Review.
  // chunk: the chunk's text; onlyId: open on this pattern (from Progress) even if the text is empty.
  function openGrammar(chunk, sentence, span, l, onlyId) {
    wlang = l || lang; wordBack = menuTab || 'now';
    if (span) span.classList.add('kr-sel');
    openSheet('<p class="' + C.muted + '" data-loading>Looking up…</p>');
    loadDict(wlang).then(function (d) { showGrammar(chunk, sentence, d, onlyId); }).catch(function () { showGrammar(chunk, sentence, null, onlyId); });
  }
  function showGrammar(chunk, sentence, d, onlyId) {
    var g = GR(wlang), c = chunk && g ? g.find(d, chunk)[0] : null;
    var pats = c ? c.patterns : [], verbs = c ? c.verbs : [], glosses = c ? c.glosses : [];
    if (onlyId && !pats.some(function (x) { return x.id === onlyId; })) pats = [g.byId(onlyId)].filter(Boolean);
    var title = chunk || (pats[0] ? pats[0].label : '');
    pats.forEach(function (x) { var e = (seen[wlang].p || {})[x.id]; if (e) { e[1]++; saveSeen(); } });
    var h = '<button class="-ml-1.5 -mt-1 mb-1 flex items-center gap-0.5 py-1 pr-2 font-medium text-zinc-600 active:opacity-60 dark:text-zinc-300" data-act="back" data-swipe-back>' +
      HI('chevron-left', 'size-5') + TAB_LABEL[wordBack] + '</button>' +
      '<div class="flex items-center gap-1"><div class="kr-selectable min-w-0 break-keep text-[30px] font-bold">' + esc(title) + '</div>' +
      '<button class="' + SPEAK_BTN + '" data-act="say-chunk" aria-label="Hear it">' + HI('speaker-wave', 'size-6') + '</button></div>' +
      '<p class="mt-0.5 ' + C.muted + '">Grammar pattern' + (verbs.length ? ' built on a verb' : '') + '. Learn the pattern, not the separate pieces.</p>';
    h += '<div class="mt-3 ' + C.list + '">';
    verbs.forEach(function (v, i) {
      h += '<div class="flex cursor-pointer items-center gap-3 px-4 py-3 active:bg-zinc-100 dark:active:bg-zinc-800" data-verb="' + esc(v) + '"><div class="min-w-0 flex-1">' +
        '<p class="text-xs font-semibold uppercase tracking-wider text-zinc-400">' + (i && wlang === 'ja' ? 'Or the verb' : 'Verb') + '</p><p class="text-lg font-bold">' + esc(v) + '</p>' +
        '<p class="text-zinc-600 dark:text-zinc-300">' + esc(glosses[i] || '') + '</p></div>' + HI('chevron-right', 'size-5 text-zinc-300 dark:text-zinc-600') + '</div>';
    });
    pats.forEach(function (x) {
      var st = patternState(x.id, wlang);
      var seg = function (to, label, icon, on) {
        return '<button class="flex items-center justify-center gap-1 rounded-lg py-1.5 text-sm font-semibold ' + (st === to ? on : 'text-zinc-500 dark:text-zinc-400') +
          '" data-gstatus="' + to + '" data-gid="' + x.id + '" aria-pressed="' + (st === to) + '">' + (icon ? HI(icon, 'size-4') : '') + label + '</button>';
      };
      h += '<div class="px-4 py-3"><p class="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">Pattern</p>' +
        '<p class="text-lg font-bold">' + esc(x.label) + '</p><p class="text-zinc-700 dark:text-zinc-200">' + esc(x.en) + '</p>' +
        (x.ex ? '<p class="mt-1 text-sm ' + C.muted + '">' + esc(x.ex) + '</p>' : '') +
        '<div class="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-800" role="group" aria-label="How well you know this pattern">' +
        seg('new', 'New', '', 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white') +
        seg('learning', 'Learning', 'star', 'bg-violet-600 text-white shadow-sm') +
        seg('known', 'Known', 'check', 'bg-emerald-500 text-white shadow-sm') + '</div></div>';
    });
    if (c && c.ending) {
      h += '<div class="px-4 py-3"><p class="text-xs font-semibold uppercase tracking-wider text-zinc-400">Ending</p>' +
        '<p class="text-lg font-bold">' + esc(c.ending.form) + '</p><p class="text-zinc-600 dark:text-zinc-300">' + esc(c.ending.en) + '</p></div>';
    }
    h += '</div>';
    if (sentence) {
      var marked = chunk ? esc(sentence).split(esc(chunk)).join('<mark class="' + C.mark + '">' + esc(chunk) + '</mark>') : esc(sentence);
      h += '<div class="mt-3 flex items-start gap-1 ' + C.card + '"><p class="kr-selectable flex-1 leading-relaxed text-zinc-800 dark:text-zinc-200">' + marked + '</p>' +
        '<button class="' + SPEAK_BTN + ' -my-1.5 -mr-2" data-act="say-sentence" aria-label="Hear the sentence">' + HI('speaker-wave', 'size-5') + '</button></div>';
      h += '<div class="mt-3"><a class="' + C.btn + '" target="_blank" rel="noopener" href="https://translate.google.com/?sl=' + wlang + '&tl=en&op=translate&text=' + encodeURIComponent(sentence) + '">Google Translate ' + HI('arrow-top-right-on-square', 'size-4 text-zinc-400') + '</a></div>';
    }
    card.onclick = null;
    openSheet(h, true);
    card.querySelector('[data-act=close]').onclick = closeSheet;
    card.querySelector('[data-act=back]').onclick = function () { goBack(wordBack); };
    card.querySelector('[data-act=say-chunk]').onclick = function () { speak(chunk || title, wlang); };
    if (sentence) card.querySelector('[data-act=say-sentence]').onclick = function () { speak(sentence, wlang); };
    Array.prototype.forEach.call(card.querySelectorAll('[data-verb]'), function (r) { r.onclick = function () { openWord(r.dataset.verb, sentence, null, wlang); }; });
    Array.prototype.forEach.call(card.querySelectorAll('[data-gstatus]'), function (btn) {
      btn.onclick = function () {
        var id = btn.dataset.gid, to = btn.dataset.gstatus;
        if (to === patternState(id, wlang)) return;
        setPatternStatus(GR(wlang).byId(id), chunk, sentence, to);
        showGrammar(chunk, sentence, d, onlyId);
      };
    });
  }

  // ---------- saved words list: search and date headings ----------
  var savedQuery = '';
  function norm(t) { return String(t || '').toLowerCase().normalize('NFC'); }
  function savedMatches(x, q) {
    if (!q) return true;
    return [x.base, x.w, x.reading, x.gloss, x.s, x.place, x.game].some(function (f) { return norm(f).indexOf(q) >= 0; });
  }
  // Today / Yesterday / This week / Earlier, from the time the word was saved.
  function dayGroup(t) {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var day = 864e5, start = d0.getTime();
    if (t >= start) return 'Today';
    if (t >= start - day) return 'Yesterday';
    if (t >= start - 6 * day) return 'This week';
    return 'Earlier';
  }
  function savedListHTML(query) {
    var q = norm(query.trim()), list = saved.slice().sort(function (a, b) { return (b.t || 0) - (a.t || 0); }).filter(function (x) { return savedMatches(x, q); });
    if (!list.length) return '<p class="mt-3 px-1 ' + C.muted + '">No saved words match “' + esc(query.trim()) + '”.</p>';
    var h = q ? '<p class="mt-3 px-1 ' + C.muted + '">' + list.length + ' of ' + saved.length + ' words</p>' : '', group = null;
    list.forEach(function (x) {
      var g = dayGroup(x.t || 0);
      if (g !== group) {
        if (group !== null) h += '</div>';
        h += '<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">' + g + '</p><div class="mt-1.5 ' + C.list + '">';
        group = g;
      }
      // Tapping a word opens its word sheet (meaning, Learning / Known, hear it); the back button returns here.
      h += '<div class="flex cursor-pointer items-start gap-2 px-4 py-3 active:bg-zinc-100 dark:active:bg-zinc-800" data-open="' + x.t + '"><div class="min-w-0 flex-1"><p class="font-bold">' + esc(x.base || x.w) +
        (x.reading ? ' <span class="font-normal ' + C.muted + '">' + esc(x.reading) + '</span>' : '') +
        (x.kind === 'g' ? '<span class="' + C.badge + '">Grammar</span>' : x.base && x.base !== x.w ? ' <span class="font-normal ' + C.muted + '">' + esc(x.w) + '</span>' : '') + '</p>' +
        '<p class="text-zinc-600 dark:text-zinc-300">' + esc(x.gloss || '—') + '</p>' +
        (x.s ? '<p class="mt-0.5 truncate ' + C.muted + '">' + esc(x.s) + '</p>' : '') + whereHTML(x.place, x.game, 'mt-1') + '</div>' +
        '<button class="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800" data-del="' + x.t + '" aria-label="Remove">' + HI('x-mark', 'size-5') + '</button></div>';
    });
    return h + '</div>';
  }

  // ---------- review: saved words come back, with the moment you saved them ----------
  // Spaced repetition, adapting per word (like a simplified Anki):
  //  - iv: days until the next review; ease: how fast that grows. A new word's first "Got it" waits
  //    1 day, then each "Got it" multiplies the wait by the word's ease (2.5 to start: 1, 3, 8, 20, 50,
  //    125 days...). There is no finish line: a word becomes Known on its own only once the next wait
  //    would be half a year or more.
  //  - "Again" starts the word over (next "Got it": 1 day) and lowers its ease, so a word you keep
  //    forgetting comes back more often from then on. It is shown once more at the end of the session.
  //  - New words (never reviewed): at most newPerDay() a day (a setting, 15 by default), so a long game doesn't bury you in reviews.
  //  - Reviews of words you've started: at most reviewsPerDay() a day (a setting, 100 by default; 0 = no
  //    limit), most overdue first, so coming back after a break doesn't mean hundreds at once.
  var DAY = 864e5, EASE = 2.5, MIN_EASE = 1.3, KNOWN_DAYS = 180;
  function reviewsPerDay() { return [50, 100, 200, 0].indexOf(settings.reviewsPerDay) >= 0 ? settings.reviewsPerDay : 100; }
  function reviewsLeft() { newLeft(); var cap = reviewsPerDay(); return cap ? Math.max(0, cap - (newToday.r || 0)) : Infinity; }
  function newPerDay() { return [5, 10, 15, 20, 30].indexOf(settings.newPerDay) >= 0 ? settings.newPerDay : 15; }
  // Older saved words used a fixed ladder (step 0..5): carry their progress over.
  var OLD_LADDER = [1, 3, 7, 14, 30];
  function sched(x) {
    if (typeof x.iv !== 'number') { x.iv = x.step ? OLD_LADDER[Math.min(x.step, 5) - 1] : 0; x.ease = EASE; x.reps = x.step || 0; delete x.step; }
    if (typeof x.ease !== 'number') x.ease = EASE;
    return x;
  }
  function nextIv(x) { sched(x); return x.iv ? Math.max(x.iv + 1, Math.round(x.iv * x.ease)) : 1; }
  function isNew(x) { return !sched(x).reps; }
  // How many new words you've started today (kept per calendar day).
  var newToday = { day: '', n: 0 };
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function newLeft() { if (newToday.day !== today()) newToday = { day: today(), n: 0, r: 0 }; return Math.max(0, newPerDay() - newToday.n); }
  if (store) store.getItem('review-day').then(function (v) { if (v && v.day) newToday = v; }).catch(function () {});
  function dueAt(x) { return typeof x.due === 'number' ? x.due : (x.t || 0); }
  // Due now: every review that is due, plus new words up to today's limit (oldest saved first).
  function dueList() {
    var n = Date.now(), byDue = function (a, b) { return dueAt(a) - dueAt(b); };
    var due = saved.filter(function (x) { return dueAt(x) <= n; });
    var reviews = due.filter(function (x) { return !isNew(x); }).sort(byDue).slice(0, reviewsLeft());
    var fresh = due.filter(isNew).sort(function (a, b) { return (a.t || 0) - (b.t || 0); }).slice(0, newLeft());
    return reviews.concat(fresh);
  }
  function inDays(d) { return d === 1 ? 'tomorrow' : 'in ' + d + ' days'; }
  // When a time is, in calendar days: "later today", "tomorrow", "in 3 days".
  function whenText(ms) {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var d = Math.floor((ms - d0.getTime()) / DAY);
    return d <= 0 ? 'later today' : inDays(d);
  }
  // A picture of the top screen (where the game's text box is) when the word is saved, as a small JPEG.
  // The game screen of each finished page (last 30), so a word saved later, from Now or Earlier, still gets
  // the moment its sentence was on screen.
  var pageShots = [];
  function grabPage() {
    if (!current || !pageFinished() || !settings.study) return;
    var pg = currentPage(), key = current.key + '|' + pg;
    if (!pg || pageShots.length && pageShots[pageShots.length - 1].key === key) return;
    try {
      var c = window.screenCanvas && screenCanvas[0];
      if (!c || !window.emuIsGameLoaded) return;
      pageShots.push({ key: key, text: pg.replace(/\s+/g, ''), url: c.toDataURL('image/jpeg', 0.75) });
      if (pageShots.length > 30) pageShots.shift();
    } catch (e) {}
  }
  function snapshot(t, sentence) {
    try {
      var c = window.screenCanvas && screenCanvas[0], url = null, q = String(sentence || '').replace(/\s+/g, '');
      if (q) for (var i = pageShots.length - 1; i >= 0 && !url; i--) {
        var tx = pageShots[i].text;
        if (tx.indexOf(q.slice(0, Math.min(6, q.length))) >= 0 || q.indexOf(tx.slice(0, Math.min(6, tx.length))) >= 0) url = pageShots[i].url;
      }
      // The page on screen now, if it shows the sentence (or nothing better is known).
      if (current && q && currentPage().replace(/\s+/g, '').indexOf(q.slice(0, Math.min(6, q.length))) >= 0) url = null;
      if (!url && c && window.emuIsGameLoaded) url = c.toDataURL('image/jpeg', 0.75);
      if (url && store) store.setItem('shot:' + t, url).catch(function () {});
    } catch (e) {}
  }
  function dropShot(t) { if (store && store.removeItem) store.removeItem('shot:' + t).catch(function () {}); }
  // The session: the words due when it started, plus any you pressed Again on.
  var review = null;   // { queue: [t, ...], open: false, done: 0 }
  function reviewWord() { while (review && review.queue.length) { var t = review.queue[0], x = saved.filter(function (y) { return y.t === t; })[0]; if (x) return x; review.queue.shift(); } return null; }
  // Review session, full screen: progress bar and close at the top, the card in the middle, and the
  // answer buttons at the bottom within thumb reach. One black button per step (Show meaning / Got it).
  function reviewHTML() {
    if (!review) review = { queue: dueList().map(function (x) { return x.t; }), open: false, done: 0, total: 0 };
    if (!review.total) review.total = review.queue.length;
    var x = reviewWord();
    var total = Math.max(review.total, review.done + review.queue.length), pos = Math.min(total, review.done + (x ? 1 : 0));
    var h = '<div class="flex items-center gap-3 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">' +
      '<button class="-ml-2 grid size-10 place-items-center rounded-full text-zinc-500 active:bg-zinc-200 dark:text-zinc-400 dark:active:bg-zinc-800" data-act="close" aria-label="Close">' + HI('x-mark', 'size-6') + '</button>' +
      '<div class="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-2 rounded-full bg-violet-600 transition-[width]" style="width:' + (total ? Math.round(review.done / total * 100) : 0) + '%"></div></div>' +
      '<span class="min-w-10 text-right text-sm font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">' + (total ? pos + ' / ' + total : '') + '</span></div>';
    if (!x) {
      var next = saved.slice().sort(function (a, b) { return dueAt(a) - dueAt(b); })[0];
      var capped = !newLeft() && saved.some(function (y) { return isNew(y) && dueAt(y) <= Date.now(); });
      var msg = !saved.length ? 'No saved words yet. Tap a word in the subtitles and choose Learning; it comes back here to review.'
        : reviewsCapped() ? 'That’s ' + reviewsPerDay() + ' reviews for today. The rest wait until tomorrow.'
        : capped ? 'That’s ' + newPerDay() + ' new words for today. More tomorrow, so your reviews stay manageable.'
        : 'Next review ' + whenText(dueAt(next)) + '.';
      return h + '<div class="my-auto flex flex-col items-center text-center">' + HI('check', 'size-12 text-emerald-500') +
        '<p class="mt-2 text-xl font-bold">' + (review.done ? 'All done for now' : 'Nothing to review') + '</p>' +
        (review.done ? '<p class="' + C.muted + '">' + review.done + (review.done === 1 ? ' review' : ' reviews') + ' this session.</p>' : '') +
        '<p class="mt-1 px-6 ' + C.muted + '">' + msg + '</p></div>' +
        '<div class="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"><button class="' + C.primary + '" data-act="done">' + HI('play', 'size-5') + 'Back to game</button></div>';
    }
    var w = x.w || x.base, s1 = pickSentence(x.s || '', w, '');
    var sentence = s1 && s1.indexOf(w) >= 0 ? esc(s1).split(esc(w)).join('<mark class="' + C.mark + '">' + esc(w) + '</mark>') : '';
    h += '<img data-shot="' + x.t + '" alt="" class="kr-shot mx-auto mt-4 hidden ' + (review.open ? 'kr-shot-back h-32' : 'h-44') + ' w-auto rounded-xl ring-1 ring-zinc-900/10 dark:ring-white/10">' +
      (sentence ? '<div class="mt-5 flex items-start gap-1"><p class="kr-selectable flex-1 text-xl leading-relaxed">' + sentence + '</p>' +
        '<button class="' + SPEAK_BTN + ' -my-1 -mr-2" data-act="rv-say-s" aria-label="Hear the sentence">' + HI('speaker-wave', 'size-5') + '</button></div>'
        : '<p class="mt-6 text-center text-[34px] font-bold">' + esc(w) + '</p>') +
      whereHTML(x.place, x.game, 'mt-1');
    var foot;
    if (!review.open) {
      foot = '<p class="mb-3 text-center ' + C.muted + '">' + (x.kind === 'g' ? 'What does “' + esc(x.w || x.base) + '” mean? Think of the verb and the grammar.' : 'What does ' + (sentence ? 'the marked word' : 'this word') + ' mean?') + '</p>' +
        '<button class="' + C.primary + '" data-act="rv-show">Show meaning</button>';
    } else {
      var gotDays = nextIv(x), becomesKnown = gotDays >= KNOWN_DAYS;
      if (x.kind === 'g') h += grammarBackHTML(x);
      else h += '<div class="mt-5 ' + C.card + '"><div class="flex items-center gap-1"><p class="kr-selectable min-w-0 flex-1 text-3xl font-bold">' + esc(x.base || x.w) +
        (x.reading ? '<span class="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">' + esc(x.reading) + '</span>' : '') + '</p>' +
        '<button class="' + SPEAK_BTN + ' -mr-2" data-act="rv-say-w" aria-label="Hear the word">' + HI('speaker-wave', 'size-6') + '</button></div>' +
        '<p class="mt-0.5 text-lg text-zinc-700 dark:text-zinc-200">' + esc(x.gloss || '—') + '</p>' +
        (x.kind === 'g' && x.ex ? '<p class="mt-1 text-sm ' + C.muted + '">' + esc(x.ex) + '</p>' : '') +
        '<button class="mt-1 text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 active:opacity-60 dark:text-zinc-400 dark:decoration-zinc-600" data-act="rv-more">More about this word</button></div>';
      foot = '<div class="grid grid-cols-2 gap-2">' +
        '<button class="' + C.btn + ' flex-col !gap-0 !py-2.5" data-act="rv-again">Again<span class="text-xs font-normal text-zinc-500 dark:text-zinc-400">soon</span></button>' +
        '<button class="' + C.primary + ' flex-col !gap-0 !py-2.5" data-act="rv-good">Got it' +
          '<span class="text-xs font-normal text-white/70">' + (becomesKnown ? 'becomes Known' : inDays(gotDays)) + '</span></button></div>' +
        '<button class="mt-2 flex w-full items-center justify-center gap-1 py-2 text-sm font-medium text-zinc-500 active:opacity-60 dark:text-zinc-400" data-act="rv-known">' + HI('check', 'size-4') + 'I know this ' + (x.kind === 'g' ? 'pattern' : 'word') + '</button>';
    }
    // The answer area sits at the bottom of the screen.
    return h + '<div class="mt-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">' + foot + '</div>';
  }
  // Back of a grammar card: how the marked words are built (verb + pattern + ending), the pattern you are
  // learning highlighted. 써보면 = 쓰다 (to use) + -아/어 보다 (try doing) + -면 (if).
  function grammarBackHTML(x) {
    var l = x.lang || 'ko', g = GR(l), d = dicts[l];
    var c = x.w && g && d ? g.find(d, x.w)[0] : null;
    var part = function (label, word, mean, main) {
      return '<div class="flex items-baseline gap-3 py-1.5' + (main ? ' -mx-2 rounded-lg bg-violet-100 px-2 dark:bg-violet-500/20' : '') + '">' +
        '<span class="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider ' + (main ? 'text-violet-700 dark:text-violet-300' : 'text-zinc-400') + '">' + label + '</span>' +
        '<span class="min-w-0"><span class="font-bold' + (main ? ' text-violet-900 dark:text-white' : '') + '">' + esc(word) + '</span> <span class="text-zinc-600 dark:text-zinc-300">' + esc(mean) + '</span></span></div>';
    };
    var h = '<div class="mt-5 ' + C.card + '"><div class="flex items-center gap-1"><p class="kr-selectable min-w-0 flex-1 text-3xl font-bold">' + esc(x.w || x.base) + '</p>' +
      '<button class="' + SPEAK_BTN + ' -mr-2" data-act="rv-say-w" aria-label="Hear it">' + HI('speaker-wave', 'size-6') + '</button></div><div class="mt-2">';
    if (c) {
      c.verbs.forEach(function (v, i) { h += part(i ? 'or' : 'verb', v, c.glosses[i] || ''); });
      c.patterns.forEach(function (p) { h += part('pattern', p.label, p.en, p.id === x.g); });
      if (c.ending) h += part('ending', c.ending.form, c.ending.en);
    } else h += part('pattern', x.base, x.gloss, true);
    return h + '</div>' + (x.ex ? '<p class="mt-2 text-sm ' + C.muted + '">Another example: ' + esc(x.ex) + '</p>' : '') +
      '<button class="mt-1 text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 active:opacity-60 dark:text-zinc-400 dark:decoration-zinc-600" data-act="rv-more">More about this pattern</button></div>';
  }
  function openReview() {
    menuTab = 'review';
    var rx0 = review && reviewWord();
    if (rx0 && rx0.kind === 'g' && !dicts[rx0.lang || 'ko']) { loadDict(rx0.lang || 'ko').then(function () { if (card.querySelector('[data-act=rv-show], [data-act=rv-good]')) openReview(); }).catch(function () {}); }
    openSheet(reviewHTML(), false, true);
    // The extra bottom padding openSheet adds isn't needed here.
    if (card.lastChild && !card.lastChild.childNodes.length) card.removeChild(card.lastChild);
    fillShots();
    card.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act, rx = reviewWord();
      if (act === 'close') return openMenu('review');   // ✕ goes back to the Review tab
      if (act === 'done') { card.onclick = null; return closeSheet(); }
      if (act === 'rv-show') { review.open = true; return openReview(); }
      if (act === 'rv-again') return reviewAnswer('again');
      if (act === 'rv-good') return reviewAnswer('good');
      if (act === 'rv-known') return reviewAnswer('known');
      if (act === 'rv-say-s' && rx) return speak(rx.s, rx.lang);
      if (act === 'rv-say-w' && rx) return speak(rx.kind === 'g' ? rx.w : rx.base || rx.w, rx.lang);
      if (act === 'rv-more' && rx && rx.kind === 'g') return openGrammar(rx.w, rx.s || '', null, rx.lang, rx.g);
      if (act === 'rv-more' && rx) return openWord(rx.w, rx.s || '', null, rx.lang);
    };
  }
  // Load the snapshot (if there is one) into the card after it is drawn.
  function fillShots() {
    Array.prototype.forEach.call(card.querySelectorAll('img[data-shot]'), function (img) {
      if (!store) return;
      store.getItem('shot:' + img.getAttribute('data-shot')).then(function (v) { if (v) { img.src = v; img.classList.remove('hidden'); } }).catch(function () {});
    });
  }
  function reviewAnswer(how) {
    var x = reviewWord(); if (!x) return;
    review.queue.shift(); review.open = false; review.done++;
    var n = Date.now();
    sched(x);
    newLeft();
    if (!x.reps && how !== 'known') newToday.n++;
    else if (x.reps) newToday.r = (newToday.r || 0) + 1;
    if (store) store.setItem('review-day', newToday).catch(function () {});
    var iv = nextIv(x);
    x.reps++;
    if (how === 'again') { x.ease = Math.max(MIN_EASE, x.ease - 0.2); x.iv = 0; x.due = n + 10 * 60000; review.queue.push(x.t); }
    else if (how === 'good' && iv < KNOWN_DAYS) { x.iv = iv; x.due = n + iv * DAY; }
    else {
      // Next wait would be half a year or more, or "I know this word": Known, out of the saved list (Learning and Known exclude each other).
      var k = known[x.lang || lang] || known[lang];
      if (x.kind === 'g') k['g:' + x.g] = 1; else { k[x.w] = 1; if (x.base) k[x.base] = 1; }
      persistKnown();
      saved = saved.filter(function (y) { return y !== x; }); dropShot(x.t);
      toast('Known: ' + (x.base || x.w), 'ok');
      if (current) renderPanel();
    }
    persist(); updatePill();
    openReview();
  }
  // Reviews waiting that today's limit holds back.
  function reviewsCapped() { var n = Date.now(); return !reviewsLeft() && saved.some(function (y) { return !isNew(y) && dueAt(y) <= n; }); }
  function dueCount() { return dueList().length; }

  // ---------- menu: saved words / recent text ----------
  // ---------- the Study screen ----------
  // One place for everything study: Now | Words | Review | Progress, and the settings behind the gear.
  // The translate button opens it on Now; the game menu has one "Study" row that opens it too.
  var OLD_TABS = { saved: 'words', recent: 'now' };
  // Back to the page you came from, at the same scroll position (back button and swipe back).
  function goBack(tab) {
    var y = swipePrev ? swipePrev.y : 0;
    openMenu(tab);
    card.scrollTop = y;
  }
  function openMenu(tab) {
    tab = OLD_TABS[tab] || tab || 'now';
    if (!settings.study) tab = 'settings';   // study mode off: only the settings (to turn it back on)
    if (tab !== 'session') review = null;    // a review session starts fresh each time
    if (tab === 'settings' && menuTab !== 'settings') settingsBack = menuTab && menuTab !== 'session' ? menuTab : 'now';
    menuTab = tab;
    if (tab === 'session') return openReview();
    var h;
    if (tab === 'settings') h = settingsHTML();
    else {
      var due = dueCount();
      var tb = function (id, label) { return '<button class="' + C.tab + '" data-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>'; };
      var tabs = '<div class="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">' + tb('now', 'Dialogue') + tb('words', 'Words') +
        // Review: a floating badge on the corner of the word, like an app icon with notifications.
        tb('review', '<span class="relative">Review' + (due ? '<span class="absolute -right-[19px] -top-3 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#ff3b30] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-zinc-100 dark:ring-zinc-800">' + (due > 99 ? '99+' : due) + '</span>' : '') + '</span>') + tb('progress', 'Progress') + '</div>';
      h = pageMode ? PAGE_HEAD(pageFrom === 'settings' ? backLink('Settings', 'data-act="to-settings"') : '', 'Study', tabs)
        : SHEET_HEAD('', 'Study', GEAR + RESUME, '<div class="mt-3">' + tabs + '</div>');
      if (tab === 'now') h += nowHTML();
      else if (tab === 'words') h += wordsTabHTML();
      else if (tab === 'review') h += reviewStartHTML(due);
      else if (tab === 'progress') h += progressHTML();
    }
    openSheet(h, false);
    var search = card.querySelector('#kr-search');
    if (search) search.oninput = function () { savedQuery = search.value; card.querySelector('#kr-saved-list').innerHTML = savedListHTML(savedQuery); };
    card.onclick = function (e) {
      var b = e.target.closest('[data-tab],[data-act],[data-del],[data-open],[data-know],[data-pw],[data-gp],[data-mode],[data-font-pick],[data-frame-pick],[data-npd],[data-rpd],.kr-w');
      if (!b) return;
      if (b.dataset.open) {
        var x = saved.filter(function (y) { return String(y.t) === b.dataset.open; })[0];
        if (x && x.kind === 'g') openGrammar(x.w, x.s || '', null, x.lang, x.g);
        else if (x) openWord(x.w, x.s || '', null, x.lang);
        return;
      }
      if (b.classList.contains('kr-w')) {
        var line = b.closest('[data-s]');
        var pgEl = b.closest('[data-page]');
        var ls = line ? pickSentence(line.getAttribute('data-s'), b.getAttribute('data-w'), pgEl ? pgEl.getAttribute('data-page') : '') : '';
        if (b.hasAttribute('data-g')) return openGrammar(b.getAttribute('data-w'), ls);
        openWord(b.getAttribute('data-w'), ls, null);
        return;
      }
      if (b.dataset.tab) return b.hasAttribute('data-swipe-back') ? goBack(b.dataset.tab) : openMenu(b.dataset.tab);
      if (b.dataset.del) {
        saved = saved.filter(function (x) { var hit = String(x.t) === b.dataset.del; if (hit) dropShot(x.t); return !hit; }); persist(); updatePill();
        if (!saved.length) return openMenu('words');
        card.querySelector('#kr-saved-list').innerHTML = savedListHTML(savedQuery);
        var cnt = card.querySelector('#kr-search'); if (cnt) cnt.placeholder = 'Search ' + saved.length + ' saved ' + (saved.length === 1 ? 'word' : 'words');
        return;
      }
      if (b.dataset.know) { markKnown([b.dataset.know]); return stay('progress'); }
      if (b.dataset.gp) { var sp = (seen[lang].p || {})[b.dataset.gp] || []; return openGrammar(sp[2] || '', sp[3] || '', null, lang, b.dataset.gp); }
      if (b.dataset.pw) { var e2 = seen[lang].w[b.dataset.pw]; return openWord(b.dataset.pw, e2 ? e2[2] : '', null, lang); }
      if (b.dataset.fontPick) { setFont(b.dataset.fontPick); return stay('settings'); }
      if (b.dataset.framePick) { setFrame(b.dataset.framePick); return stay('settings'); }
      if (b.dataset.npd) { settings.newPerDay = +b.dataset.npd; saveSettings(); return stay('settings'); }
      if (b.dataset.rpd !== undefined) { settings.reviewsPerDay = +b.dataset.rpd; saveSettings(); return stay('settings'); }
      var act = b.dataset.act;
      if (act === 'close') { card.onclick = null; return closeSheet(); }
      if (act === 'to-settings') { card.onclick = null; return closeSheet(true); }
      if (act === 'say-now') { var nb = card.querySelector('.kr-now'); return speak(nb ? nb.getAttribute('data-s') : ''); }
      if (act === 'start-review') return openMenu('session');
      if (act === 'pg-know-all') { markKnown(Array.prototype.map.call(card.querySelectorAll('[data-know]'), function (n) { return n.dataset.know; })); return stay('progress'); }
      if (act === 'study-toggle') { setStudy(!settings.study); if (settings.study) stay('settings'); else toast('Study mode off', 'ok'); return; }
      if (act === 'reset-box') { resetBox(); return; }
      if (act === 'log-more') { logShown += 60; return stay('now'); }
      // The gear: the game menu, where the study settings live.
      if (act === 'game-menu') { closeSheet(); if (window.emuOpenMenu) window.emuOpenMenu(); return; }
    };
  }
  var SEC = function (t, extra) { return '<p class="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400' + (extra || '') + '">' + t + '</p>'; };
  // Now: the current line on top, earlier dialogue and other text below.
  function nowHTML() {
    var nowText = current ? plain(current.text.slice(0, current.shown)) : (history.length ? history[history.length - 1] : '');
    var full = current ? plain(current.text) : nowText, h = '';
    if (!nowText.trim()) h += '<p class="mt-4 ' + C.muted + '">No dialogue on screen right now. Talk to someone in the game.</p>';
    else h += '<div class="kr-now mt-4 ' + C.card + '" data-s="' + esc(full.replace(/\n+/g, ' ')) + '"><div class="flex items-start gap-1"><div class="kr-selectable flex-1 text-xl leading-relaxed">' +
        // each page in its own block, so a word tapped there gets that page's sentence
        nowText.split(/\n\n+/).filter(function (x) { return x.trim(); }).map(function (pg) { return '<div data-page="' + esc(pg.replace(/\n+/g, ' ')) + '">' + wordsHTML(pg) + '</div>'; }).join('') + '</div>' +
        '<button class="' + SPEAK_BTN + ' -my-1 -mr-2" data-act="say-now" aria-label="Hear it">' + HI('speaker-wave', 'size-5') + '</button></div>' +
        '<p class="mt-1 text-sm ' + C.muted + '">Tap a word to look it up · press and hold to select and copy</p></div>';
    // Earlier: this game's conversations on a timeline, newest first, grouped by day.
    return h + timelineHTML();
  }
  var logShown = 60;
  function dayLabel(t) {
    var d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(d); day.setHours(0, 0, 0, 0);
    var diff = Math.round((today - day) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', diff < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }
  function clock(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function timelineHTML() {
    if (!log.length) return '';
    var h = '', lastDay = '', open = false;
    log.slice(0, logShown).forEach(function (c) {
      var day = dayLabel(c.t);
      if (day !== lastDay) {
        if (open) h += '</div>';
        h += SEC(day) + '<div class="kr-tl">'; open = true; lastDay = day;
      }
      var n = (c.at || []).length + 1, live = c === liveConv;
      var prev = n > 1 ? c.at[c.at.length - 1] : 0;
      h += '<div class="kr-tl-item' + (live ? ' kr-tl-live' : '') + '"><p class="kr-tl-meta">' + clock(c.t) + (live ? ' · now' : '') +
        (n > 1 ? ' <span class="kr-tl-count">×' + n + '</span> <span>also ' + (dayLabel(prev) === day ? 'at ' + clock(prev) : dayLabel(prev).toLowerCase().replace(/^(\d)/, 'on $1') + ' ' + clock(prev)) + '</span>' : '') + '</p>' +
        '<div class="mt-1 ' + C.list + '">' + c.l.map(function (t) {
          var s1 = t.replace(/\n+/g, ' ');
          return '<div class="kr-selectable px-4 py-2.5 leading-relaxed" data-s="' + esc(s1) + '">' + wordsHTML(s1) + '</div>';
        }).join('') + '</div></div>';
    });
    if (open) h += '</div>';
    if (log.length > logShown) h += '<button class="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-violet-600 active:bg-zinc-100 dark:text-violet-300 dark:active:bg-zinc-800" data-act="log-more">Show older conversations</button>';
    return h;
  }
  function wordsTabHTML() {
    if (!saved.length) return '<p class="mt-4 ' + C.muted + '">No saved words yet. Tap a word in the subtitles and choose Learning.</p>';
    // Search box (16px text so iPhone doesn't zoom in) and the list, which re-renders on its own
    // while typing so the keyboard stays open.
    return '<div class="relative mt-3"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">' + HI('magnifying-glass', 'size-5') + '</span>' +
      '<input type="search" id="kr-search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
      'placeholder="Search ' + saved.length + ' saved ' + (saved.length === 1 ? 'word' : 'words') + '" value="' + esc(savedQuery) + '" ' +
      'class="w-full rounded-xl bg-white py-2.5 pl-10 pr-3 text-base text-zinc-900 shadow-sm outline-none ring-1 ring-zinc-900/5 placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10"></div>' +
      '<div id="kr-saved-list">' + savedListHTML(savedQuery) + '</div>';
  }
  // Review: how many are due, one Start button, and what is coming up. The session is full screen.
  function reviewStartHTML(due) {
    var n = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var endTomorrow = d0.getTime() + 2 * DAY, endWeek = d0.getTime() + 8 * DAY;
    var later = saved.filter(function (x) { return dueAt(x) > n; });
    var tomorrow = later.filter(function (x) { return dueAt(x) < endTomorrow; }).length;
    var week = later.filter(function (x) { return dueAt(x) < endWeek; }).length;
    var mins = Math.max(1, Math.round(due * 10 / 60));
    var h = '<div class="mt-4 ' + C.card + ' text-center">' +
      '<span class="mx-auto grid size-12 place-items-center rounded-2xl ' + (due ? 'bg-violet-100 text-violet-700 dark:bg-violet-600/15 dark:text-violet-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400') + '">' + HI(due ? 'academic-cap' : 'check', 'size-6') + '</span>';
    if (due) h += '<p class="mt-2 text-3xl font-bold">' + due + (due === 1 ? ' word' : ' words') + '</p><p class="' + C.muted + '">ready to review · about ' + mins + (mins === 1 ? ' minute' : ' minutes') + '</p>' +
      '<button class="mt-4 ' + C.primary + '" data-act="start-review">Start review</button>';
    else h += '<p class="mt-2 text-xl font-bold">Nothing to review right now</p><p class="mt-0.5 px-2 ' + C.muted + '">' +
      (!saved.length ? 'Tap a word in the subtitles and choose Learning; it comes back here to review.'
        : reviewsCapped() ? 'That’s ' + reviewsPerDay() + ' reviews for today. The rest wait until tomorrow.'
        : !newLeft() && saved.some(function (y) { return isNew(y) && dueAt(y) <= n; }) ? 'That’s ' + newPerDay() + ' new words for today. More tomorrow.'
        : 'Next review ' + whenText(Math.min.apply(null, saved.map(dueAt))) + '.') + '</p>';
    h += '</div>' + SEC('Coming up') + '<div class="mt-1.5 ' + C.list + '">' +
      [['Tomorrow', tomorrow], ['This week', week], ['New words left today', newLeft() + ' of ' + newPerDay()]].concat(reviewsPerDay() ? [['Reviews left today', reviewsLeft() + ' of ' + reviewsPerDay()]] : []).map(function (r) {
        return '<div class="flex items-center px-4 py-3"><span class="flex-1">' + r[0] + '</span><span class="' + C.muted + '">' + (typeof r[1] === 'number' ? r[1] + (r[1] === 1 ? ' word' : ' words') : r[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="mt-3 px-1 text-sm ' + C.muted + '">Words you mark as Learning come back here at growing intervals until you know them.</p>';
    return h;
  }
  // Study settings, behind the gear.
  var FRAME_NAMES = { classic: 'Classic', ball: 'Poké Ball', ocean: 'Ocean', night: 'Night', sakura: 'Sakura' };
  // The study settings inside the game menu (Menu > Study), under the Study row: same settings as the
  // settings page, as one list. onChange: emu.js refreshes the menu (the Study row's summary).
  function fillMenuSettings(el, onChange) {
    var p = settingsParts(), row = 'flex items-center gap-2 px-4 py-2.5';
    // The same groups as the Study settings page: study mode, then Subtitles and Review.
    var h = '<div class="' + C.list + '">' + p.study.replace('px-4 py-3', 'px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-800') + '</div>';
    if (settings.study) h += SEC('Subtitles') + '<div class="mt-1.5 ' + C.list + '">' + p.font + p.frame + p.reset + '</div>' +
      SEC('Review') + '<div class="mt-1.5 ' + C.list + '">' + p.npdRow + p.rpdRow + '</div>';
    el.innerHTML = h;
    el.onclick = function (e) {
      var b = e.target.closest('[data-act],[data-font-pick],[data-frame-pick],[data-npd],[data-rpd]');
      if (!b) return;
      if (b.dataset.fontPick) setFont(b.dataset.fontPick);
      else if (b.dataset.framePick) setFrame(b.dataset.framePick);
      else if (b.dataset.npd) { settings.newPerDay = +b.dataset.npd; saveSettings(); }
      else if (b.dataset.rpd !== undefined) { settings.reviewsPerDay = +b.dataset.rpd; saveSettings(); }
      else if (b.dataset.act === 'study-toggle') setStudy(!settings.study);
      else if (b.dataset.act === 'reset-box') { resetBox(); toast('Box back in its place', 'ok'); return; }
      fillMenuSettings(el, onChange);
      if (onChange) onChange();
    };
  }
  function stacked(name, sub, segHTML) {
    return '<div class="px-4 py-3"><p>' + name + '</p><p class="text-sm ' + C.muted + '">' + sub + '</p><div class="mt-2">' +
      segHTML.replace('class="flex rounded-lg', 'class="flex w-full rounded-lg').replace(/class="rounded-md px-2.5/g, 'class="flex-1 rounded-md px-2') + '</div></div>';
  }
  function settingsParts() {
    var SW = function (on) { return '<span class="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ' + (on ? 'bg-violet-600 dark:bg-violet-500' : 'bg-zinc-200 dark:bg-zinc-700') + '"><span class="absolute left-0.5 top-0.5 size-[27px] rounded-full bg-white shadow transition-transform' + (on ? ' translate-x-5' : '') + '"></span></span>'; };
    var seg = function (attr, opts, cur) {
      return '<div class="flex rounded-lg bg-zinc-100 p-0.5 text-[13px] dark:bg-zinc-800">' + opts.map(function (o) {
        return '<button class="rounded-md px-2.5 py-1.5 text-zinc-500 aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-zinc-900 aria-pressed:shadow-sm dark:text-zinc-400 dark:aria-pressed:bg-zinc-600 dark:aria-pressed:text-white" ' + attr + '="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(cur)) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    };
    return {
      study: '<button class="flex w-full items-center gap-3 px-4 py-3 text-left" data-act="study-toggle" role="switch" aria-checked="' + settings.study + '"><span class="flex-1">Study mode<span class="block text-sm ' + C.muted + '">' +
        (settings.study ? 'Subtitles, word lookup, review and progress' : 'Off: no subtitles and no translate button') + '</span></span>' + SW(settings.study) + '</button>',
      font: '<div class="px-4 py-2.5"><div class="flex items-center"><span class="flex-1">Font</span><span class="text-sm ' + C.muted + '">' + FONTS[settings.font || 'gothic'] + '</span></div>' +
        '<div class="mt-1.5 grid grid-cols-3 gap-2">' + Object.keys(FONTS).map(function (f) {
          return '<button class="rounded-xl bg-zinc-100 px-2 py-2 text-center ring-2 ring-transparent aria-pressed:bg-white aria-pressed:ring-zinc-900 dark:bg-zinc-800 dark:aria-pressed:bg-zinc-600 dark:aria-pressed:ring-white" data-font-pick="' + f + '" aria-pressed="' + ((settings.font || 'gothic') === f) + '">' +
            '<span class="kr-font-sample block text-xl leading-tight text-zinc-900 dark:text-white" data-font="' + f + '">' + (lang === 'ja' ? 'あいう' : '가나다') + '</span><span class="mt-0.5 block text-xs ' + C.muted + '">' + FONTS[f] + '</span></button>';
        }).join('') + '</div></div>',
      frame: '<div class="px-4 py-2.5"><div class="flex items-center"><span class="flex-1">Box frame</span><span class="text-sm ' + C.muted + '">' + (FRAME_NAMES[settings.frame] || '') + '</span></div>' +
        '<div class="-mx-1.5 mt-0.5 flex gap-0.5 overflow-x-auto px-0.5 py-1">' + Object.keys(FRAME_NAMES).map(function (f) {
          return '<button class="grid place-items-center rounded-xl p-1.5 ring-2 ring-transparent aria-pressed:ring-zinc-900 dark:aria-pressed:ring-white" data-frame-pick="' + f + '" aria-label="' + FRAME_NAMES[f] + ' frame" aria-pressed="' + (settings.frame === f) + '"><span class="kr-frame-swatch" data-frame="' + f + '"></span></button>';
        }).join('') + '</div></div>',
      reset: '<button class="flex w-full items-center px-4 py-3 text-left text-zinc-600 active:bg-zinc-50 dark:text-zinc-300 dark:active:bg-zinc-800" data-act="reset-box">Reset box position</button>',
      // The two daily limits: name and explanation on top, the choices full width below.
      npdRow: stacked('New flashcards a day', 'Saved words that join your reviews each day', seg('data-npd', [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']], newPerDay())),
      rpdRow: stacked('Reviews a day', 'Most overdue first; the rest wait until tomorrow', seg('data-rpd', [[50, '50'], [100, '100'], [200, '200'], [0, 'No limit']], reviewsPerDay()))
    };
  }
  function settingsHTML() {
    var p = settingsParts();
    // Back to the Study screen: a chevron before the title (swipe back works too).
    var back = settings.study ? '<button class="-ml-2 grid size-10 shrink-0 place-items-center rounded-full text-zinc-500 active:bg-zinc-200 dark:text-zinc-400 dark:active:bg-zinc-800" data-tab="' + settingsBack + '" data-swipe-back aria-label="Back to Study">' + HI('chevron-left', 'size-6') + '</button>' : '';
    // On the Study page: Study settings is a page too, back to Study (or to Settings when study mode is off).
    if (pageMode) back = settings.study ? backLink('Study', 'data-tab="' + settingsBack + '"') : pageFrom === 'settings' ? backLink('Settings', 'data-act="to-settings"') : '';
    var h = (pageMode ? PAGE_HEAD(back, 'Study settings') : SHEET_HEAD(back, 'Study settings', RESUME)) +
      '<div class="mt-3 ' + C.list + '">' + p.study + '</div>';
    if (!settings.study) return h;
    h += SEC('Subtitles') + '<div class="mt-1.5 ' + C.list + '">' + p.font + p.frame + p.reset;
    h += '</div>' + SEC('Review') + '<div class="mt-1.5 ' + C.list + '">' + p.npdRow + p.rpdRow + '</div>';
    return h;
  }




  function updatePill() { if (!settings.debug) pill.innerHTML = HI('academic-cap'); }
  // Uses the app-wide toast (emu.js), so every notification looks the same.
  function toast(msg, icon) { if (window.toast) window.toast(msg, { icon: icon }); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  loadSaved();
  loadKnown();
})();
