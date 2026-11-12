// Korean subtitle + vocabulary overlay for CheeseLab.
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
    setItem: function (k, v) { return KV.set('kr-' + k, v); }
  } : window.localforage ? localforage.createInstance({ name: 'kr-vocab' }) : null;
  // lang: the game's language, set by the app when a game loads ('ko' Korean, 'ja' Japanese).
  var lang = 'ko', dicts = {}, dictLoading = {};
  var LANG = {
    ko: { file: 'dict.json', dictName: 'Naver', dictUrl: 'https://korean.dict.naver.com/koendict/#/search?query=' },
    ja: { file: 'ja-dict.json', dictName: 'Jisho', dictUrl: 'https://jisho.org/search/' }
  };
  var saved = [];             // [{w, base, gloss, s, t}]
  var history = [];           // finished dialogue messages (newest last)
  var otherText = [];         // other Korean text seen (menus, descriptions)
  // mode: 'box' = Pokémon-style box over the game's own text, 'bar' = bar at the top, 'off' = only via 가
  // study: false hides everything Korean-related (subtitles, translate button, word sheets) and stops reading.
  var settings = { mode: 'box', study: true, debug: /krdebug/.test(location.search) };
  var frame = 0, views = null, hideTimer = null, current = null;

  // ---------- DOM ----------
  var panel = el('div', { id: 'kr-panel', className: 'kr-hidden' });
  var textBox = el('div', { className: 'kr-text' });
  panel.appendChild(textBox);
  var pill = el('button', { id: 'kr-pill', ariaLabel: 'Words', innerHTML: HI('language') });
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
    primary: 'flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 font-semibold text-amber-950 shadow-sm active:scale-[0.98] active:bg-amber-300',
    saved: 'flex items-center gap-1.5 rounded-xl bg-amber-100 px-3.5 py-2 font-semibold text-amber-900 ring-1 ring-amber-300 active:scale-95 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30',
    save: 'flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 font-semibold text-amber-950 shadow-sm active:scale-95',
    card: 'rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/10',
    list: 'divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10',
    muted: 'text-sm text-zinc-500 dark:text-zinc-400',
    badge: 'ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    tab: 'flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold text-zinc-500 aria-pressed:bg-white aria-pressed:text-zinc-900 aria-pressed:shadow-sm dark:text-zinc-400 dark:aria-pressed:bg-zinc-700 dark:aria-pressed:text-white',
    mark: 'rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-400/30',
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
    if (store) store.setItem('settings', { mode: settings.mode, box: boxGeo, study: settings.study }).catch(function () {});
  }
  function setStudy(on) {
    settings.study = !!on;
    saveSettings();
    applyStudy();
  }
  // active: false while a game without study support runs (GBA); the setting itself is kept.
  var active = true;
  function studyOn() { return settings.study && active; }
  function applyStudy() {
    pill.hidden = !studyOn();
    if (!studyOn()) {
      current = null;
      setPanelVisible(false); box.classList.add('kr-hidden');
      if (!sheet.hidden) closeSheet();
    }
    renderPanel();
  }
  function resetBox() { boxGeo = {}; saveSettings(); krLayout(); toast('Subtitle box reset', 'ok'); }
  window.KRReaderStats = function () { return reader.stats; };
  window.KRSettings = { getMode: function () { return settings.mode; }, setMode: setMode, savedCount: function () { return saved.length; },
    getStudy: function () { return settings.study; }, setStudy: setStudy,
    setActive: function (on) { active = !!on; applyStudy(); } };
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
      applyStudy();
      krLayout();
      renderPanel();
    }).catch(function () {});
  }
  function persist() {
    if (!store) return;
    store.setItem('saved', saved).catch(function () { toast('Could not save', 'warn'); });
  }
  function isSaved(word) { var c = KRLookup.clean(word); return saved.some(function (x) { return x.w === c || x.base === c; }); }

  function loadDict(l) {
    l = l || lang;
    if (dicts[l]) return Promise.resolve(dicts[l]);
    if (!dictLoading[l]) {
      dictLoading[l] = fetch(BASE + LANG[l].file).then(function (r) { return r.json(); })
        .then(function (d) { dicts[l] = d; if (l === 'ja') renderPanel(); return d; })   // re-split words once the dictionary is there
        .catch(function (e) { dictLoading[l] = null; throw e; });
    }
    return dictLoading[l];
  }
  // Called by the app when a game loads: read and look up text in that game's language.
  window.KRSetLang = function (l) {
    l = l === 'ja' ? 'ja' : 'ko';
    if (l !== lang) { lang = l; reader.setLang(l); current = null; history = []; otherText = []; renderPanel(); }
    if (l === 'ja') loadDict('ja').catch(function () {});   // needed to split Japanese into words
  };

  // ---------- emulator hooks ----------
  window.krOnFrame = function () {
    if (!studyOn() || ++frame % SCAN_EVERY) return;
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
    if (spot) { pill.style.left = (spot.x - 24) + 'px'; pill.style.top = (spot.y - 24) + 'px'; }
    // Landscape: in the empty band above the top screen when there is room, so it doesn't cover the L button.
    else { pill.style.left = (r.left + 6) + 'px'; pill.style.top = (r.top >= 44 ? Math.max(6, (r.top - 32) / 2) : r.top + 6) + 'px'; }
    // Both HeartGold and White draw the dialogue box on the top screen at DS pixels
    // x 4..252, y 146..190, with two 16 px text lines starting at y 152.
    var k = r.width / 256;
    // Full width, stuck to the bottom of the top screen, covering the game's box.
    placeBox();
  };

  function handleScan(res) {
    res.fresh.forEach(function (t) {
      t = plain(t).trim();
      if (t.length >= 2 && otherText.indexOf(t) < 0) { otherText.push(t); if (otherText.length > 150) otherText.shift(); }
    });
    if (res.newMessage && current) archive(current);
    if (res.active) {
      current = res.active;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (res.changed) renderPanel();
      if (!dicts[lang]) loadDict().catch(function () {});
    } else if (res.closed && current) {
      archive(current);
      current = null;
      box.classList.add('kr-hidden');   // the game's own box has closed too
      hideTimer = setTimeout(function () { setPanelVisible(false); hideTimer = null; }, HIDE_AFTER_MS);
    }
    pill.classList.toggle('kr-live', !!current);
    if (settings.debug) pill.textContent = reader.stats.korean + '/' + reader.stats.printers;
  }

  function archive(msg) {
    var t = plain(msg.text).trim();
    if (t && history[history.length - 1] !== t) { history.push(t); if (history.length > 100) history.shift(); }
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
          return p.w ? '<span class="kr-w' + (isSaved(p.t) ? ' kr-saved' : '') + '" data-w="' + p.t + '">' + p.t + '</span>' : p.t;
        }).join('');
      }).join('<br>');
    }
    return esc(text).split('\n').map(function (line) {
      return line.split(/( +)/).map(function (tok) {
        if (!tok.trim()) return tok;
        if (!/[가-힣]/.test(tok)) return tok;
        return '<span class="kr-w' + (isSaved(tok) ? ' kr-saved' : '') + '" data-w="' + tok + '">' + tok + '</span>';
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
    var mode = studyOn() ? settings.mode : 'off';
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
    '<button class="' + C.primary + '" data-act="close">' + HI('play', 'size-5') + 'Back to game</button></div>';
  function openSheet(html, withBack) {
    if (sheet.hidden) pause();
    card.innerHTML = GRAB + html + (withBack ? BACK : '<div class="pb-[calc(1.5rem+env(safe-area-inset-bottom))]"></div>');
    sheet.hidden = false; card.scrollTop = 0;
  }
  function closeSheet() {
    sheet.hidden = true; resume(); menuTab = null;
    Array.prototype.forEach.call(document.querySelectorAll('.kr-sel'), function (n) { n.classList.remove('kr-sel'); });
    if (current) renderPanel();
  }

  // ---------- word sheet ----------
  // Which Words & text tab the word sheet's back button returns to: the tab the word was
  // tapped in, or Now when it was tapped in the subtitles.
  var menuTab = null, wordBack = 'now';
  var TAB_LABEL = { now: 'Now', saved: 'Saved words', recent: 'Recent' };
  function openWord(raw, sentence, span) {
    var word = KRLookup.clean(raw);
    if (lang === 'ja') {
      wordBack = menuTab || 'now';
      if (span) span.classList.add('kr-sel');
      openSheet('<p class="' + C.muted + '">Looking up…</p>');
      loadDict('ja').then(function (d) { var r = KRLookupJa.lookup(d, raw, 5); showWord(r.matched, r.matched, sentence, r.hits); })
        .catch(function () { showWord(KRLookupJa.clean(raw), raw, sentence, null); });
      return;
    }
    wordBack = menuTab || 'now';
    if (span) span.classList.add('kr-sel');
    openSheet('<p class="' + C.muted + '">Looking up…</p>');
    loadDict().then(function (d) { showWord(word, raw, sentence, KRLookup.lookup(d, raw, 3)); })
      .catch(function () { showWord(word, raw, sentence, null); });
  }

  function showWord(word, raw, sentence, hits) {
    var savedNow = isSaved(word), OUT = HI('arrow-top-right-on-square', 'size-4 text-zinc-400');
    var h = '<button class="-ml-1.5 -mt-1 mb-1 flex items-center gap-0.5 py-1 pr-2 font-medium text-amber-600 active:opacity-60 dark:text-amber-400" data-act="back">' +
      HI('chevron-left', 'size-5') + TAB_LABEL[wordBack] + '</button>' +
      '<div class="flex items-center gap-3"><div class="kr-selectable flex-1 break-keep text-[30px] font-bold">' + esc(word) + '</div>' +
      '<button class="' + (savedNow ? C.saved : C.save) + '" data-act="save">' +
      (savedNow ? HI('star', 'size-5') + 'Saved' : HI('star-outline', 'size-5') + 'Save') + '</button></div>';
    if (hits === null) h += '<p class="mt-3 ' + C.muted + '">Dictionary not available offline yet. Use the links below.</p>';
    else if (!hits.length) h += '<p class="mt-3 ' + C.muted + '">Not in the offline dictionary. Try ' + LANG[lang].dictName + ' below, or long‑press the word above → Look Up.</p>';
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
      h += '<p class="kr-selectable mt-3 ' + C.card + ' leading-relaxed text-zinc-800 dark:text-zinc-200">' + marked + '</p>';
    }
    var base = hits && hits[0] ? hits[0].word : word;
    h += '<div class="mt-3 grid ' + (sentence ? 'grid-cols-2' : 'grid-cols-1') + ' gap-2">' +
      '<a class="' + C.btn + '" target="_blank" rel="noopener" href="' + LANG[lang].dictUrl + encodeURIComponent(base) + '">' + LANG[lang].dictName + ' ' + OUT + '</a>' +
      (sentence ? '<a class="' + C.btn + '" target="_blank" rel="noopener" href="https://translate.google.com/?sl=' + lang + '&tl=en&op=translate&text=' + encodeURIComponent(sentence) + '">Google ' + OUT + '</a>' : '') +
      '</div>';
    card.onclick = null;
    openSheet(h, true);
    card.querySelector('[data-act=close]').onclick = closeSheet;
    card.querySelector('[data-act=back]').onclick = function () { openMenu(wordBack); };
    card.querySelector('[data-act=save]').onclick = function () {
      if (isSaved(word)) {
        saved = saved.filter(function (x) { return x.w !== word && x.base !== word; });
        toast('Removed ' + base, 'trash');
      } else {
        saved.push({ w: word, base: base, reading: hits && hits[0] ? hits[0].reading || '' : '', gloss: hits && hits[0] ? hits[0].gloss : '', s: sentence || '', t: Date.now(), lang: lang });
        toast('Saved: ' + base, 'star');
      }
      persist(); updatePill();
      showWord(word, raw, sentence, hits);
    };
  }

  // ---------- menu: saved words / recent text ----------
  function openMenu(tab) {
    menuTab = tab;
    var tb = function (id, label) { return '<button class="' + C.tab + '" data-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>'; };
    var h = '<div class="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">' + tb('now', 'Now') +
      tb('saved', HI('star', 'size-4 text-amber-500 relative -top-[1.25px]') + saved.length) + tb('recent', 'Recent') + '</div>';
    if (tab === 'now') {
      // Current dialogue (what has been typed so far), else the last finished message.
      var nowText = current ? plain(current.text.slice(0, current.shown)) : (history.length ? history[history.length - 1] : '');
      var full = current ? plain(current.text) : nowText;
      if (!nowText.trim()) h += '<p class="mt-3 ' + C.muted + '">No dialogue on screen right now. Older text is under Recent.</p>';
      else {
        h += '<div class="kr-now mt-3 ' + C.card + '" data-s="' + esc(full.replace(/\n+/g, ' ')) + '">' +
          wordsHTML(nowText.replace(/\n\n+/g, '\n')) + '</div>' +
          '<p class="mt-2 px-1 ' + C.muted + '">Tap a word to look it up.</p>';
      }
    } else if (tab === 'saved') {
      if (!saved.length) h += '<p class="mt-3 ' + C.muted + '">No saved words yet. Tap any word in the subtitles, then Save.</p>';
      else {
        h += '<div class="mt-3 ' + C.list + '">';
        saved.slice().reverse().forEach(function (x) {
          h += '<div class="flex items-start gap-2 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-bold">' + esc(x.base || x.w) +
            (x.reading ? ' <span class="font-normal ' + C.muted + '">' + esc(x.reading) + '</span>' : '') +
            (x.base && x.base !== x.w ? ' <span class="font-normal ' + C.muted + '">' + esc(x.w) + '</span>' : '') + '</p>' +
            '<p class="text-zinc-600 dark:text-zinc-300">' + esc(x.gloss || '—') + '</p>' +
            (x.s ? '<p class="mt-0.5 truncate ' + C.muted + '">' + esc(x.s) + '</p>' : '') + '</div>' +
            '<button class="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800" data-del="' + x.t + '" aria-label="Remove">' + HI('x-mark', 'size-5') + '</button></div>';
        });
        h += '</div><div class="mt-3 grid grid-cols-2 gap-2"><button class="' + C.btn + '" data-act="export">Export for Anki</button><button class="' + C.btn + '" data-act="copy">Copy list</button></div>';
      }
    } else if (tab === 'recent') {
      var lines = history.slice().reverse();
      if (current) lines.unshift(plain(current.text));
      if (!lines.length && !otherText.length) h += '<p class="mt-3 ' + C.muted + '">Nothing yet. Talk to someone in the game.</p>';
      var block = function (arr) {
        return '<div class="mt-3 ' + C.list + '">' + arr.map(function (t) {
          var s1 = t.replace(/\n+/g, ' ');
          return '<div class="px-4 py-2.5 leading-relaxed" data-s="' + esc(s1) + '">' + wordsHTML(s1) + '</div>';
        }).join('') + '</div>';
      };
      if (lines.length) h += block(lines);
      if (otherText.length) h += '<p class="mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Other text on screen</p>' + block(otherText.slice().reverse().slice(0, 60));
    }
    openSheet(h, true);
    card.onclick = function (e) {
      var b = e.target.closest('[data-tab],[data-act],[data-del],.kr-w');
      if (!b) return;
      if (b.classList.contains('kr-w')) {
        var line = b.closest('[data-s]');
        openWord(b.getAttribute('data-w'), line ? line.getAttribute('data-s') : '', null);
        return;
      }
      if (b.dataset.tab) return openMenu(b.dataset.tab);
      if (b.dataset.del) { saved = saved.filter(function (x) { return String(x.t) !== b.dataset.del; }); persist(); updatePill(); return openMenu('saved'); }
      var act = b.dataset.act;
      if (act === 'close') { card.onclick = null; return closeSheet(); }
      if (act === 'export') return exportCSV();
      if (act === 'copy') return copyList();
    };
  }

  function csvField(s) { s = String(s || ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCSV() {
    var rows = saved.map(function (x) {
      return [x.base || x.w, x.gloss, x.s, x.w, x.reading || ''].map(csvField).join(',');
    });
    var csv = '#separator:comma\n#columns:Word,Meaning,Sentence,As seen,Reading\n' + rows.join('\n') + '\n';
    var name = 'pokemon-words.csv';
    var file = null;
    try { file = new File([csv], name, { type: 'text/csv' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Saved words' }).catch(function () {});
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
  }
  function copyList() {
    var txt = saved.map(function (x) { return (x.base || x.w) + ' — ' + (x.gloss || '') + (x.s ? '\n   ' + x.s : ''); }).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Copied', 'ok'); }, function () { toast('Copy failed', 'warn'); });
  }

  function updatePill() { if (!settings.debug) pill.innerHTML = HI('language'); }
  // Uses the app-wide toast (emu.js), so every notification looks the same.
  function toast(msg, icon) { if (window.toast) window.toast(msg, { icon: icon }); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  loadSaved();
})();
