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
  // mode: 'box' = Pokémon-style box over the game's own text, 'bar' = bar at the top, 'off' = only via 가
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
  box.appendChild(boxText); box.appendChild(boxArrow); box.appendChild(boxGrip); box.appendChild(boxSize);
  // User-placed box per orientation, in DS pixels relative to the top screen's top-left.
  var boxGeo = {};
  var BOX_DEFAULT = { x: 0, y: 142, w: 256, h: 50 };
  var sheet = el('div', { id: 'kr-sheet', className: 'fixed inset-0 z-30 flex flex-col justify-end bg-black/40', hidden: true });
  var card = el('div', { className: 'kr-card h-[var(--sheet-h,auto)] max-h-[var(--sheet-max,92vh)] flex flex-col [&>*]:shrink-0 overflow-y-auto rounded-t-3xl bg-zinc-50 px-4 pt-2 text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-white' });
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
    mark: 'rounded bg-violet-200 px-0.5 text-inherit dark:bg-violet-600/30',
  };
  sheet.appendChild(card);

  function mount() {
    var player = document.getElementById('player') || document.body;
    player.appendChild(panel); player.appendChild(box); player.appendChild(pill);
    document.body.appendChild(sheet);
    // The emulator's window-level touch handler swallows every touch while the game runs.
    // Stop our touches from reaching it so taps and scrolling work here.
    [panel, box, pill, sheet].forEach(function (n) {
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
        n.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
      });
      n.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    });
    textBox.addEventListener('click', onWordTap);
    boxText.addEventListener('click', onWordTap);
    dragBox(boxGrip, 'move'); dragBox(boxSize, 'size');
    pill.addEventListener('click', function () { openMenu('now'); });
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

  function el(tag, props) { var n = document.createElement(tag); for (var k in props) n[k] = props[k]; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function plain(s) { return s.replace(/​/g, '').replace(/·+/g, '…'); }

  // ---------- storage ----------
  function setMode(m) {
    settings.mode = m === 'bar' || m === 'off' ? m : 'box';
    saveSettings();
    renderPanel();
  }
  function saveSettings() {
    if (store) store.setItem('settings', { mode: settings.mode, box: boxGeo, study: settings.study, frame: settings.frame, newPerDay: settings.newPerDay }).catch(function () {});
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
      if (!sheet.hidden) closeSheet();
    }
    renderPanel();
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
  window.KRUI = { open: function (tab) { openMenu(tab || 'now'); }, resetBox: resetBox };

  function loadSaved() {
    if (!store) return;
    store.getItem('saved').then(function (v) { if (Array.isArray(v)) saved = v; updatePill(); }).catch(function () {});
    store.getItem('settings').then(function (v) {
      if (!v) return;
      // Older versions stored {subs: true/false} for the bar.
      settings.mode = v.mode || (v.subs === false ? 'off' : v.subs === true ? 'bar' : 'box');
      if (v.box && typeof v.box === 'object') boxGeo = v.box;
      settings.study = v.study !== false;
      settings.frame = FRAMES.indexOf(v.frame) >= 0 ? v.frame : 'classic';
      if (v.newPerDay) settings.newPerDay = v.newPerDay;
      box.dataset.frame = settings.frame;
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
  window.KRSetGame = function (id, name) { game = { id: String(id || '').trim(), name: String(name || '').trim() }; };
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

  function savedEntry(word) { var c = KRLookup.clean(word); for (var i = saved.length - 1; i >= 0; i--) if (saved[i].w === c || saved[i].base === c) return saved[i]; return null; }
  function isSaved(word) { var c = KRLookup.clean(word); return saved.some(function (x) { return x.w === c || x.base === c; }); }

  function loadDict(l) {
    l = l || lang;
    if (dicts[l]) return Promise.resolve(dicts[l]);
    if (!dictLoading[l]) {
      dictLoading[l] = fetch(BASE + LANG[l].file).then(function (r) { return r.json(); })
        .then(function (d) { dicts[l] = d; baseOf.clear(); if (current) renderPanel(); return d; })   // re-split words / mark known words once the dictionary is there
        .catch(function (e) { dictLoading[l] = null; throw e; });
    }
    return dictLoading[l];
  }
  // Called by the app when a game loads: read and look up text in that game's language.
  window.KRSetLang = function (l) {
    l = l === 'ja' ? 'ja' : 'ko';
    if (l !== lang) { lang = l; reader.setLang(l); current = null; history = []; renderPanel(); }
    if (l === 'ja') loadDict('ja').catch(function () {});   // needed to split Japanese into words
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
    current = null;
    box.classList.add('kr-hidden');   // the game's own box has closed too
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { setPanelVisible(false); hideTimer = null; }, HIDE_AFTER_MS);
  }
  function archive(msg) {
    var t = plain(msg.text).trim();
    if (t && history[history.length - 1] !== t) { history.push(t); if (history.length > 100) history.shift(); countText(t); }
  }

  // ---------- subtitle panel ----------
  function setPanelVisible(v) {
    panel.classList.toggle('kr-hidden', !v);
  }

  // Turn text into tappable word spans.
  function wordsHTML(text) {
    if (lang === 'ja') {
      return esc(text).split('\n').map(function (line) {
        return KRLookupJa.segment(dicts.ja || null, line).map(function (p) {
          return p.w ? '<span class="' + wordClass(p.t) + '" data-w="' + p.t + '">' + p.t + '</span>' : p.t;
        }).join('');
      }).join('<br>');
    }
    return esc(text).split('\n').map(function (line) {
      return line.split(/( +)/).map(function (tok) {
        if (!tok.trim()) return tok;
        if (!/[가-힣]/.test(tok)) return tok;
        return '<span class="' + wordClass(tok) + '" data-w="' + tok + '">' + tok + '</span>';
      }).join('');
    }).join('<br>');
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
      panel.scrollTop = panel.scrollHeight;
    } else {
      // The game's box holds two lines; when it scrolls, the last two are visible.
      var lines = page.split('\n');
      boxText.innerHTML = wordsHTML(lines.slice(-2).join('\n'));
      boxArrow.style.visibility = pageFinished() ? 'visible' : 'hidden';
      box.classList.toggle('kr-hidden', page.length === 0);
      if (boxGeo[screens().key]) fitBox();
    }
  }

  function onWordTap(e) {
    var t = e.target.closest ? e.target.closest('.kr-w') : null;
    if (!t) return;
    var sentence = current ? plain(current.text).replace(/\n+/g, ' ') : t.closest('[data-s]') ? t.closest('[data-s]').getAttribute('data-s') : '';
    var raw = t.getAttribute('data-w');
    if (lang === 'ja') {
      // Japanese: look up from the tapped word to the end of the phrase, so a longer word or an
      // inflected verb that spans several pieces is still found (いって|きます -> 行く).
      for (var n = t.nextSibling; n && n.nodeType === 1 && n.classList.contains('kr-w'); n = n.nextSibling) raw += n.getAttribute('data-w');
    }
    openWord(raw, sentence, t);
  }

  // ---------- pause / resume ----------
  var wasRunning = false;
  function pause() { wasRunning = !!window.emuIsRunning; window.emuIsRunning = false; }
  function resume() { if (wasRunning && window.uiCurrentMode === 'player' && window.emuIsGameLoaded) window.emuIsRunning = true; wasRunning = false; }
  var GRAB = '<div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"></div>'; // same handle as the menu
  // "Back to game" stays pinned to the bottom of the sheet while the content above it scrolls.
  var BACK = '<div class="sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-zinc-50 from-70% to-zinc-50/0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 dark:from-zinc-950 dark:to-zinc-950/0">' +
    '<button class="' + C.secondary + '" data-act="close">' + HI('play', 'size-5 text-violet-500 dark:text-violet-300') + 'Back to game</button></div>';
  // Back to game is the secondary button everywhere (soft lilac); solid purple is kept for real actions
  // (Start review, Show meaning, Got it).
  function openSheet(html, withBack, full) {
    if (sheet.hidden) pause();
    sheet.classList.toggle('kr-full', !!full);
    card.innerHTML = (full ? '' : GRAB) + html + (withBack ? BACK : '<div class="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"></div>');
    sheet.hidden = false; card.scrollTop = 0;
  }
  function closeSheet() {
    sheet.hidden = true; sheet.classList.remove('kr-full'); resume(); menuTab = null; review = null;
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
      for (var g in a.g) { var G = b.g[g] || (b.g[g] = { name: a.g[g].name, n: 0, w: {} }); G.n += a.g[g].n; for (var k2 in a.g[g].w) G.w[k2] = (G.w[k2] || 0) + a.g[g].w[k2]; }
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
    lineWords(text).forEach(function (tok) {
      var k = wordKey(tok); if (!k) return;
      var e = S.w[k] || (S.w[k] = [0, 0, '']);
      e[0]++; e[2] = line.length <= 120 ? line : e[2];
      G.w[k] = (G.w[k] || 0) + 1; G.n++;
    });
    saveSeen();
  }
  function noteLookup(base, l) {
    if (!base) return;
    var e = seen[l].w[base] || (seen[l].w[base] = [0, 0, '']);
    e[1]++; saveSeen();
  }
  // How a word stands: 'known', 'learning' (saved) or 'new'.
  function wordState(k, l) { return known[l][k] ? 'known' : saved.some(function (x) { return (x.lang || 'ko') === l && (x.base === k || x.w === k); }) ? 'learning' : 'new'; }
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
    var likely = Object.keys(S.w).filter(function (k) { var e = S.w[k]; return e[0] >= 15 && !e[1] && wordState(k, lang) === 'new'; })
      .sort(function (a, b) { return S.w[b][0] - S.w[a][0]; }).slice(0, 8);
    if (likely.length) {
      h += '<div class="mt-5 flex items-end px-1"><p class="flex-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Probably known</p>' +
        '<button class="text-sm font-semibold text-zinc-600 active:opacity-60 dark:text-zinc-300" data-act="pg-know-all">Mark all as known</button></div>' +
        '<p class="mt-0.5 px-1 text-sm ' + C.muted + '">Read many times and never looked up.</p><div class="mt-1.5 ' + C.list + '">' +
        likely.map(function (k) { return progRow(k, S.w[k][0] + '× read', '<button class="' + C.btn + ' !px-3 !py-1.5 text-sm" data-know="' + esc(k) + '">' + HI('check', 'size-4') + 'Know</button>'); }).join('') + '</div>';
    }
    // Worth learning: words you keep looking up first, then the most frequent new words in this game.
    var worth = Object.keys(G ? G.w : {}).filter(function (k) { return wordState(k, lang) === 'new' && likely.indexOf(k) < 0; })
      .sort(function (a, b) { var la = (S.w[a] || [0, 0])[1] >= 2, lb = (S.w[b] || [0, 0])[1] >= 2; return la !== lb ? (lb ? 1 : -1) : G.w[b] - G.w[a]; }).slice(0, 10);
    if (worth.length) {
      h += '<p class="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Worth learning</p>' +
        '<p class="mt-0.5 px-1 text-sm ' + C.muted + '">Words you keep looking up, and the most common new words in this game. Tap one to learn it.</p><div class="mt-1.5 ' + C.list + '">' +
        worth.map(function (k) { var e = S.w[k] || [0, 0]; return progRow(k, G.w[k] + '× read' + (e[1] >= 2 ? ' · looked up ' + e[1] + '×' : ''), HI('chevron-right', 'size-5 text-zinc-300 dark:text-zinc-600'), true); }).join('') + '</div>';
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
  var menuTab = null, wordBack = 'now';
  var TAB_LABEL = { now: 'Study', words: 'Words', review: 'Review', progress: 'Progress', session: 'Review', settings: 'Study settings' };
  // l: the word's own language (a saved word from a game in the other language); default the game's.
  var wlang = 'ko';
  function openWord(raw, sentence, span, l) {
    wlang = l || lang;
    var word = KRLookup.clean(raw);
    if (wlang === 'ja') {
      wordBack = menuTab || 'now';
      if (span) span.classList.add('kr-sel');
      openSheet('<p class="' + C.muted + '">Looking up…</p>');
      loadDict('ja').then(function (d) { var r = KRLookupJa.lookup(d, raw, 5); noteLookup(r.hits && r.hits[0] ? r.hits[0].word : r.matched, wlang); showWord(r.matched, r.matched, sentence, r.hits); })
        .catch(function () { showWord(KRLookupJa.clean(raw), raw, sentence, null); });
      return;
    }
    wordBack = menuTab || 'now';
    if (span) span.classList.add('kr-sel');
    openSheet('<p class="' + C.muted + '">Looking up…</p>');
    loadDict(wlang).then(function (d) { var hits = KRLookup.lookup(d, raw, 3); noteLookup(hits && hits[0] ? hits[0].word : word, wlang); showWord(word, raw, sentence, hits); })
      .catch(function () { showWord(word, raw, sentence, null); });
  }

  function showWord(word, raw, sentence, hits) {
    var savedNow = isSaved(word), OUT = HI('arrow-top-right-on-square', 'size-4 text-zinc-400');
    var base = hits && hits[0] ? hits[0].word : word, knownNow = !savedNow && !!(known[wlang][word] || known[wlang][base]);
    // One status per word: New, Learning (saved to your list) or Known (no underline in the subtitles).
    var status = savedNow ? 'learning' : knownNow ? 'known' : 'new';
    var segBtn = function (st, label, icon, on) {
      return '<button class="flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold transition-colors ' + (status === st ? on : 'text-zinc-500 dark:text-zinc-400') +
        '" data-status="' + st + '" aria-pressed="' + (status === st) + '">' + (icon ? HI(icon, 'size-4') : '') + label + '</button>';
    };
    var h = '<button class="-ml-1.5 -mt-1 mb-1 flex items-center gap-0.5 py-1 pr-2 font-medium text-zinc-600 active:opacity-60 dark:text-zinc-300" data-act="back">' +
      HI('chevron-left', 'size-5') + TAB_LABEL[wordBack] + '</button>' +
      '<div class="flex items-center gap-1"><div class="kr-selectable min-w-0 break-keep text-[30px] font-bold">' + esc(word) + '</div>' +
      '<button class="' + SPEAK_BTN + '" data-act="say-word" aria-label="Hear the word">' + HI('speaker-wave', 'size-6') + '</button></div>' +
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
          (x.how ? '<span class="' + C.badge + '">' + esc(x.how) + '</span>' : '') + '</p>' +
          '<p class="mt-0.5 text-zinc-600 dark:text-zinc-300">' + esc(x.gloss) + '</p></div>';
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
    card.querySelector('[data-act=back]').onclick = function () { openMenu(wordBack); };
    card.querySelector('[data-act=say-word]').onclick = function () { speak(word, wlang); };
    if (sentence) card.querySelector('[data-act=say-sentence]').onclick = function () { speak(sentence, wlang); };
    Array.prototype.forEach.call(card.querySelectorAll('[data-status]'), function (btn) {
      btn.onclick = function () {
        var to = btn.dataset.status;
        if (to === status) return;
        var k = known[wlang];
        // Learning and Known exclude each other: a word you know leaves your saved list, and back.
        if (to !== 'learning' && isSaved(word)) {
          saved = saved.filter(function (x) { var hit = x.w === word || x.base === word || x.w === base || x.base === base; if (hit) dropShot(x.t); return !hit; });
          persist(); updatePill();
        }
        if (to !== 'known') { delete k[word]; delete k[base]; }
        if (to === 'learning') {
          var t = Date.now();
          saved.push({ w: word, base: base, reading: hits && hits[0] ? hits[0].reading || '' : '', gloss: hits && hits[0] ? hits[0].gloss : '', s: sentence || '', t: t, lang: wlang,
            place: place, game: game.name, due: t, iv: 0, ease: EASE, reps: 0 });
          snapshot(t);
          persist(); updatePill();
          toast('Saved: ' + base, 'star');
        } else if (to === 'known') { k[word] = 1; k[base] = 1; toast('Known: ' + base, 'ok'); }
        else toast('Marked as new: ' + base, 'info');
        persistKnown();
        showWord(word, raw, sentence, hits);
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
        (x.base && x.base !== x.w ? ' <span class="font-normal ' + C.muted + '">' + esc(x.w) + '</span>' : '') + '</p>' +
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
  var DAY = 864e5, EASE = 2.5, MIN_EASE = 1.3, KNOWN_DAYS = 180;
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
  function newLeft() { if (newToday.day !== today()) newToday = { day: today(), n: 0 }; return Math.max(0, newPerDay() - newToday.n); }
  if (store) store.getItem('review-day').then(function (v) { if (v && v.day) newToday = v; }).catch(function () {});
  function dueAt(x) { return typeof x.due === 'number' ? x.due : (x.t || 0); }
  // Due now: every review that is due, plus new words up to today's limit (oldest saved first).
  function dueList() {
    var n = Date.now(), byDue = function (a, b) { return dueAt(a) - dueAt(b); };
    var due = saved.filter(function (x) { return dueAt(x) <= n; });
    var reviews = due.filter(function (x) { return !isNew(x); }).sort(byDue);
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
  function snapshot(t) {
    try {
      var c = window.screenCanvas && screenCanvas[0];
      if (c && store && window.emuIsGameLoaded) store.setItem('shot:' + t, c.toDataURL('image/jpeg', 0.75)).catch(function () {});
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
        : capped ? 'That’s ' + newPerDay() + ' new words for today. More tomorrow, so your reviews stay manageable.'
        : 'Next review ' + whenText(dueAt(next)) + '.';
      return h + '<div class="my-auto flex flex-col items-center text-center">' + HI('check', 'size-12 text-emerald-500') +
        '<p class="mt-2 text-xl font-bold">' + (review.done ? 'All done for now' : 'Nothing to review') + '</p>' +
        (review.done ? '<p class="' + C.muted + '">' + review.done + (review.done === 1 ? ' review' : ' reviews') + ' this session.</p>' : '') +
        '<p class="mt-1 px-6 ' + C.muted + '">' + msg + '</p></div>' +
        '<div class="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"><button class="' + C.primary + '" data-act="done">' + HI('play', 'size-5') + 'Back to game</button></div>';
    }
    var s1 = x.s || '', w = x.w || x.base;
    var sentence = s1 && s1.indexOf(w) >= 0 ? esc(s1).split(esc(w)).join('<mark class="' + C.mark + '">' + esc(w) + '</mark>') : '';
    h += '<img data-shot="' + x.t + '" alt="" class="kr-shot mx-auto mt-4 hidden ' + (review.open ? 'kr-shot-back h-32' : 'h-44') + ' w-auto rounded-xl ring-1 ring-zinc-900/10 dark:ring-white/10">' +
      (sentence ? '<div class="mt-5 flex items-start gap-1"><p class="kr-selectable flex-1 text-xl leading-relaxed">' + sentence + '</p>' +
        '<button class="' + SPEAK_BTN + ' -my-1 -mr-2" data-act="rv-say-s" aria-label="Hear the sentence">' + HI('speaker-wave', 'size-5') + '</button></div>'
        : '<p class="mt-6 text-center text-[34px] font-bold">' + esc(w) + '</p>') +
      whereHTML(x.place, x.game, 'mt-1');
    var foot;
    if (!review.open) {
      foot = '<p class="mb-3 text-center ' + C.muted + '">What does ' + (sentence ? 'the marked word' : 'this word') + ' mean?</p>' +
        '<button class="' + C.primary + '" data-act="rv-show">Show meaning</button>';
    } else {
      var gotDays = nextIv(x), becomesKnown = gotDays >= KNOWN_DAYS;
      h += '<div class="mt-5 ' + C.card + '"><div class="flex items-center gap-1"><p class="kr-selectable min-w-0 flex-1 text-3xl font-bold">' + esc(x.base || x.w) +
        (x.reading ? '<span class="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">' + esc(x.reading) + '</span>' : '') + '</p>' +
        '<button class="' + SPEAK_BTN + ' -mr-2" data-act="rv-say-w" aria-label="Hear the word">' + HI('speaker-wave', 'size-6') + '</button></div>' +
        '<p class="mt-0.5 text-lg text-zinc-700 dark:text-zinc-200">' + esc(x.gloss || '—') + '</p>' +
        '<button class="mt-1 text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 active:opacity-60 dark:text-zinc-400 dark:decoration-zinc-600" data-act="rv-more">More about this word</button></div>';
      foot = '<div class="grid grid-cols-2 gap-2">' +
        '<button class="' + C.btn + ' flex-col !gap-0 !py-2.5" data-act="rv-again">Again<span class="text-xs font-normal text-zinc-500 dark:text-zinc-400">soon</span></button>' +
        '<button class="' + C.primary + ' flex-col !gap-0 !py-2.5" data-act="rv-good">Got it' +
          '<span class="text-xs font-normal text-white/70">' + (becomesKnown ? 'becomes Known' : inDays(gotDays)) + '</span></button></div>' +
        '<button class="mt-2 flex w-full items-center justify-center gap-1 py-2 text-sm font-medium text-zinc-500 active:opacity-60 dark:text-zinc-400" data-act="rv-known">' + HI('check', 'size-4') + 'I know this word</button>';
    }
    // The answer area sits at the bottom of the screen.
    return h + '<div class="mt-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">' + foot + '</div>';
  }
  function openReview() {
    menuTab = 'review';
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
      if (act === 'rv-say-w' && rx) return speak(rx.base || rx.w, rx.lang);
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
    if (!x.reps && how !== 'known') { newLeft(); newToday.n++; if (store) store.setItem('review-day', newToday).catch(function () {}); }
    var iv = nextIv(x);
    x.reps++;
    if (how === 'again') { x.ease = Math.max(MIN_EASE, x.ease - 0.2); x.iv = 0; x.due = n + 10 * 60000; review.queue.push(x.t); }
    else if (how === 'good' && iv < KNOWN_DAYS) { x.iv = iv; x.due = n + iv * DAY; }
    else {
      // Next wait would be half a year or more, or "I know this word": Known, out of the saved list (Learning and Known exclude each other).
      var k = known[x.lang || lang] || known[lang];
      k[x.w] = 1; if (x.base) k[x.base] = 1; persistKnown();
      saved = saved.filter(function (y) { return y !== x; }); dropShot(x.t);
      toast('Known: ' + (x.base || x.w), 'ok');
      if (current) renderPanel();
    }
    persist(); updatePill();
    openReview();
  }
  function dueCount() { return dueList().length; }

  // ---------- menu: saved words / recent text ----------
  // ---------- the Study screen ----------
  // One place for everything study: Now | Words | Review | Progress, and the settings behind the gear.
  // The translate button opens it on Now; the game menu has one "Study" row that opens it too.
  var OLD_TABS = { saved: 'words', recent: 'now' };
  function openMenu(tab) {
    tab = OLD_TABS[tab] || tab || 'now';
    if (!settings.study) tab = 'settings';   // study mode off: only the settings (to turn it back on)
    if (tab !== 'session') review = null;    // a review session starts fresh each time
    menuTab = tab;
    if (tab === 'session') return openReview();
    var h;
    if (tab === 'settings') h = settingsHTML();
    else {
      var due = dueCount();
      var tb = function (id, label) { return '<button class="' + C.tab + '" data-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>'; };
      h = '<div class="flex items-center"><p class="flex-1 text-xl font-bold">Study</p>' +
        '<button class="-mr-2 grid size-10 place-items-center rounded-full text-zinc-500 active:bg-zinc-200 dark:text-zinc-400 dark:active:bg-zinc-800" data-tab="settings" aria-label="Study settings">' + HI('cog-6-tooth', 'size-6') + '</button></div>' +
        '<div class="mt-2 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">' + tb('now', 'Now') + tb('words', 'Words') +
        // Review: a floating badge on the corner of the word, like an app icon with notifications.
        tb('review', '<span class="relative">Review' + (due ? '<span class="absolute -right-[19px] -top-3 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#ff3b30] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-zinc-100 dark:ring-zinc-800">' + (due > 99 ? '99+' : due) + '</span>' : '') + '</span>') + tb('progress', 'Progress') + '</div>';
      if (tab === 'now') h += nowHTML();
      else if (tab === 'words') h += wordsTabHTML();
      else if (tab === 'review') h += reviewStartHTML(due);
      else if (tab === 'progress') h += progressHTML();
    }
    openSheet(h, true);
    var search = card.querySelector('#kr-search');
    if (search) search.oninput = function () { savedQuery = search.value; card.querySelector('#kr-saved-list').innerHTML = savedListHTML(savedQuery); };
    card.onclick = function (e) {
      var b = e.target.closest('[data-tab],[data-act],[data-del],[data-open],[data-know],[data-pw],[data-mode],[data-frame-pick],[data-npd],.kr-w');
      if (!b) return;
      if (b.dataset.open) {
        var x = saved.filter(function (y) { return String(y.t) === b.dataset.open; })[0];
        if (x) openWord(x.w, x.s || '', null, x.lang);
        return;
      }
      if (b.classList.contains('kr-w')) {
        var line = b.closest('[data-s]');
        openWord(b.getAttribute('data-w'), line ? line.getAttribute('data-s') : '', null);
        return;
      }
      if (b.dataset.tab) return openMenu(b.dataset.tab);
      if (b.dataset.del) {
        saved = saved.filter(function (x) { var hit = String(x.t) === b.dataset.del; if (hit) dropShot(x.t); return !hit; }); persist(); updatePill();
        if (!saved.length) return openMenu('words');
        card.querySelector('#kr-saved-list').innerHTML = savedListHTML(savedQuery);
        var cnt = card.querySelector('#kr-search'); if (cnt) cnt.placeholder = 'Search ' + saved.length + ' saved ' + (saved.length === 1 ? 'word' : 'words');
        return;
      }
      if (b.dataset.know) { markKnown([b.dataset.know]); return openMenu('progress'); }
      if (b.dataset.pw) { var e2 = seen[lang].w[b.dataset.pw]; return openWord(b.dataset.pw, e2 ? e2[2] : '', null, lang); }
      if (b.dataset.mode) { setMode(b.dataset.mode); return openMenu('settings'); }
      if (b.dataset.framePick) { setFrame(b.dataset.framePick); return openMenu('settings'); }
      if (b.dataset.npd) { settings.newPerDay = +b.dataset.npd; saveSettings(); return openMenu('settings'); }
      var act = b.dataset.act;
      if (act === 'close') { card.onclick = null; return closeSheet(); }
      if (act === 'say-now') { var nb = card.querySelector('.kr-now'); return speak(nb ? nb.getAttribute('data-s') : ''); }
      if (act === 'start-review') return openMenu('session');
      if (act === 'pg-know-all') { markKnown(Array.prototype.map.call(card.querySelectorAll('[data-know]'), function (n) { return n.dataset.know; })); return openMenu('progress'); }
      if (act === 'study-toggle') { setStudy(!settings.study); if (settings.study) openMenu('settings'); else toast('Study mode off', 'ok'); return; }
      if (act === 'reset-box') { resetBox(); return; }
    };
  }
  var SEC = function (t, extra) { return '<p class="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400' + (extra || '') + '">' + t + '</p>'; };
  // Now: the current line on top, earlier dialogue and other text below.
  function nowHTML() {
    var nowText = current ? plain(current.text.slice(0, current.shown)) : (history.length ? history[history.length - 1] : '');
    var full = current ? plain(current.text) : nowText, h = '';
    if (!nowText.trim()) h += '<p class="mt-4 ' + C.muted + '">No dialogue on screen right now. Talk to someone in the game.</p>';
    else h += '<div class="kr-now mt-4 ' + C.card + '" data-s="' + esc(full.replace(/\n+/g, ' ')) + '"><div class="flex items-start gap-1"><div class="flex-1 text-xl leading-relaxed">' +
        wordsHTML(nowText.replace(/\n\n+/g, '\n')) + '</div>' +
        '<button class="' + SPEAK_BTN + ' -my-1 -mr-2" data-act="say-now" aria-label="Hear it">' + HI('speaker-wave', 'size-5') + '</button></div>' +
        '<p class="mt-1 text-sm ' + C.muted + '">Tap a word to look it up</p></div>';
    // Earlier: finished dialogue, newest first (the current line is shown above).
    var lines = history.slice().reverse();
    if (!current && lines.length) lines.shift();
    var block = function (arr) {
      return '<div class="mt-1.5 ' + C.list + '">' + arr.map(function (t) {
        var s1 = t.replace(/\n+/g, ' ');
        return '<div class="px-4 py-2.5 leading-relaxed" data-s="' + esc(s1) + '">' + wordsHTML(s1) + '</div>';
      }).join('') + '</div>';
    };
    if (lines.length) h += SEC('Earlier') + block(lines.slice(0, 60));
    // Only character dialogue (no signs or other text on screen).
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
        : !newLeft() && saved.some(function (y) { return isNew(y) && dueAt(y) <= n; }) ? 'That’s ' + newPerDay() + ' new words for today. More tomorrow.'
        : 'Next review ' + whenText(Math.min.apply(null, saved.map(dueAt))) + '.') + '</p>';
    h += '</div>' + SEC('Coming up') + '<div class="mt-1.5 ' + C.list + '">' +
      [['Tomorrow', tomorrow], ['This week', week], ['New words left today', newLeft() + ' of ' + newPerDay()]].map(function (r) {
        return '<div class="flex items-center px-4 py-3"><span class="flex-1">' + r[0] + '</span><span class="' + C.muted + '">' + (typeof r[1] === 'number' ? r[1] + (r[1] === 1 ? ' word' : ' words') : r[1]) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="mt-3 px-1 text-sm ' + C.muted + '">Words you mark as Learning come back here at growing intervals until you know them.</p>';
    return h;
  }
  // Study settings, behind the gear.
  var FRAME_NAMES = { classic: 'Classic', ball: 'Poké Ball', ocean: 'Ocean', night: 'Night', sakura: 'Sakura' };
  function settingsHTML() {
    var SW = function (on) { return '<span class="relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ' + (on ? 'bg-violet-600 dark:bg-violet-500' : 'bg-zinc-200 dark:bg-zinc-700') + '"><span class="absolute left-0.5 top-0.5 size-[27px] rounded-full bg-white shadow transition-transform' + (on ? ' translate-x-5' : '') + '"></span></span>'; };
    var seg = function (attr, opts, cur) {
      return '<div class="flex rounded-lg bg-zinc-100 p-0.5 text-[13px] dark:bg-zinc-800">' + opts.map(function (o) {
        return '<button class="rounded-md px-2.5 py-1.5 text-zinc-500 aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-zinc-900 aria-pressed:shadow-sm dark:text-zinc-400 dark:aria-pressed:bg-zinc-600 dark:aria-pressed:text-white" ' + attr + '="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(cur)) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    };
    var h = (settings.study ? '<button class="-ml-1.5 -mt-1 flex items-center gap-0.5 py-1 pr-2 font-medium text-zinc-600 active:opacity-60 dark:text-zinc-300" data-tab="now">' + HI('chevron-left', 'size-5') + 'Study</button>' : '') +
      '<p class="mt-1 text-2xl font-bold">Study settings</p>' +
      '<div class="mt-4 ' + C.list + '"><button class="flex w-full items-center gap-3 px-4 py-3 text-left" data-act="study-toggle" role="switch" aria-checked="' + settings.study + '"><span class="flex-1">Study mode<span class="block text-sm ' + C.muted + '">' +
        (settings.study ? 'Subtitles, word lookup, review and progress' : 'Off: no subtitles and no translate button') + '</span></span>' + SW(settings.study) + '</button></div>';
    if (!settings.study) return h;
    h += SEC('Subtitles') + '<div class="mt-1.5 ' + C.list + '">' +
      '<div class="flex items-center gap-2 px-4 py-2.5"><span class="flex-1">Show</span>' + seg('data-mode', [['off', 'Off'], ['bar', 'Bar'], ['box', 'In box']], settings.mode) + '</div>';
    if (settings.mode === 'box') {
      h += '<div class="px-4 py-2.5"><div class="flex items-center"><span class="flex-1">Box frame</span><span class="text-sm ' + C.muted + '">' + (FRAME_NAMES[settings.frame] || '') + '</span></div>' +
        '<div class="-mx-1.5 mt-0.5 flex gap-0.5 overflow-x-auto px-0.5 py-1">' + Object.keys(FRAME_NAMES).map(function (f) {
          return '<button class="grid place-items-center rounded-xl p-1.5 ring-2 ring-transparent aria-pressed:ring-zinc-900 dark:aria-pressed:ring-white" data-frame-pick="' + f + '" aria-label="' + FRAME_NAMES[f] + ' frame" aria-pressed="' + (settings.frame === f) + '"><span class="kr-frame-swatch" data-frame="' + f + '"></span></button>';
        }).join('') + '</div></div>' +
        '<button class="flex w-full items-center px-4 py-3 text-left text-zinc-600 active:bg-zinc-50 dark:text-zinc-300 dark:active:bg-zinc-800" data-act="reset-box">Reset box position</button>';
    }
    h += '</div>' + SEC('Review') + '<div class="mt-1.5 ' + C.list + '"><div class="flex items-center gap-2 px-4 py-2.5"><span class="flex-1">New words per day</span>' +
      seg('data-npd', [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']], newPerDay()) + '</div></div>';
    return h;
  }




  function updatePill() { if (!settings.debug) pill.innerHTML = HI('academic-cap'); }
  // Uses the app-wide toast (emu.js), so every notification looks the same.
  function toast(msg, icon) { if (window.toast) window.toast(msg, { icon: icon }); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  loadSaved();
  loadKnown();
})();
