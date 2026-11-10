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
  var dict = null, dictLoading = null;
  var saved = [];             // [{w, base, gloss, s, t}]
  var history = [];           // finished dialogue messages (newest last)
  var otherText = [];         // other Korean text seen (menus, descriptions)
  // mode: 'box' = Pokémon-style box over the game's own text, 'bar' = bar at the top, 'off' = only via 가
  var settings = { mode: 'box', debug: /krdebug/.test(location.search) };
  var frame = 0, views = null, hideTimer = null, current = null;

  // ---------- DOM ----------
  var panel = el('div', { id: 'kr-panel', className: 'kr-hidden' });
  var textBox = el('div', { className: 'kr-text' });
  var menuBtn = el('button', { className: 'kr-menu-btn', innerHTML: HI('star', 'size-[18px]') });
  panel.appendChild(textBox); panel.appendChild(menuBtn);
  var pill = el('button', { id: 'kr-pill', ariaLabel: 'Korean words', innerHTML: HI('language') });
  var box = el('div', { id: 'kr-box', className: 'kr-hidden' });
  var boxText = el('div', { className: 'kr-box-text' });
  var boxArrow = el('div', { className: 'kr-box-arrow' });
  box.appendChild(boxText); box.appendChild(boxArrow);
  var sheet = el('div', { id: 'kr-sheet', className: 'fixed inset-0 z-30 flex flex-col justify-end bg-black/40', hidden: true });
  var card = el('div', { className: 'kr-card max-h-[82vh] overflow-y-auto rounded-t-3xl bg-zinc-50 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-white' });
  // Tailwind class sets for the sheets
  var C = {
    btn: 'flex items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2.5 font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-900/5 active:scale-[0.98] dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10',
    primary: 'flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 font-semibold text-amber-950 shadow-sm active:scale-[0.98] active:bg-amber-300',
    saved: 'flex items-center gap-1.5 rounded-xl bg-amber-100 px-3.5 py-2 font-semibold text-amber-900 ring-1 ring-amber-300 active:scale-95 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30',
    save: 'flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 font-semibold text-amber-950 shadow-sm active:scale-95',
    card: 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/10',
    list: 'divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10',
    muted: 'text-sm text-zinc-500 dark:text-zinc-400',
    badge: 'ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    tab: 'flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold text-zinc-500 aria-pressed:bg-white aria-pressed:text-zinc-900 aria-pressed:shadow-sm dark:text-zinc-400 dark:aria-pressed:bg-zinc-700 dark:aria-pressed:text-white',
    mark: 'rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-400/30',
  };
  sheet.appendChild(card);
  var toastEl = el('div', { id: 'kr-toast', style: 'opacity:0' });

  function mount() {
    var player = document.getElementById('player') || document.body;
    player.appendChild(panel); player.appendChild(box); player.appendChild(pill);
    document.body.appendChild(sheet); document.body.appendChild(toastEl);
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
    menuBtn.addEventListener('click', function () { openMenu('saved'); });
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
    if (store) store.setItem('settings', { mode: settings.mode }).catch(function () {});
    renderPanel();
  }
  window.KRReaderStats = function () { return reader.stats; };
  window.KRSettings = { getMode: function () { return settings.mode; }, setMode: setMode, savedCount: function () { return saved.length; } };
  window.KRUI = { open: function (tab) { openMenu(tab || 'now'); } };

  function loadSaved() {
    if (!store) return;
    store.getItem('saved').then(function (v) { if (Array.isArray(v)) saved = v; updatePill(); }).catch(function () {});
    store.getItem('settings').then(function (v) {
      if (!v) return;
      // Older versions stored {subs: true/false} for the bar.
      settings.mode = v.mode || (v.subs === false ? 'off' : v.subs === true ? 'bar' : 'box');
      renderPanel();
    }).catch(function () {});
  }
  function persist() {
    if (!store) return;
    store.setItem('saved', saved).catch(function () { toast('Could not save'); });
  }
  function isSaved(word) { var c = KRLookup.clean(word); return saved.some(function (x) { return x.w === c || x.base === c; }); }

  function loadDict() {
    if (dict) return Promise.resolve(dict);
    if (!dictLoading) {
      dictLoading = fetch(BASE + 'dict.json').then(function (r) { return r.json(); })
        .then(function (d) { dict = d; return d; })
        .catch(function (e) { dictLoading = null; throw e; });
    }
    return dictLoading;
  }

  // ---------- emulator hooks ----------
  window.krOnFrame = function () {
    if (++frame % SCAN_EVERY) return;
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

  window.krLayout = function () {
    var c = window.screenCanvas && screenCanvas[0];
    if (!c) return;
    var r = c.getBoundingClientRect();
    // Portrait (screens stacked): the bar sits at the top of the bottom screen, so the
    // game's own screen stays clear. Side by side: the bar stays on the top screen.
    var c2 = screenCanvas[1], r2 = c2 && c2.getBoundingClientRect();
    var stacked = r2 && r2.width > 0 && r2.top >= r.bottom - 2;
    var pr = stacked ? r2 : r;
    panel.classList.toggle('kr-below', !!stacked);
    panel.style.left = pr.left + 'px'; panel.style.top = pr.top + 'px';
    panel.style.width = pr.width + 'px'; panel.style.maxHeight = Math.round(pr.height * 0.5) + 'px';
    pill.style.left = (r.left + 6) + 'px'; pill.style.top = (r.top + 6) + 'px';
    // Both HeartGold and White draw the dialogue box on the top screen at DS pixels
    // x 4..252, y 146..190, with two 16 px text lines starting at y 152.
    var k = r.width / 256;
    box.style.left = (r.left + 4 * k) + 'px'; box.style.top = (r.top + 146 * k) + 'px';
    box.style.width = (248 * k) + 'px'; box.style.height = (44 * k) + 'px';
    box.style.setProperty('--k', k);
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
      if (!dict) loadDict().catch(function () {});
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
    pill.style.display = v ? 'none' : '';
  }

  // Turn text into tappable word spans.
  function wordsHTML(text) {
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
    var mode = settings.mode;
    if (!current || mode !== 'bar') setPanelVisible(false);
    if (!current || mode !== 'box') box.classList.add('kr-hidden');
    if (!current || mode === 'off') return;
    var page = currentPage();
    if (mode === 'bar') {
      textBox.innerHTML = wordsHTML(page);
      setPanelVisible(page.length > 0);
      panel.scrollTop = panel.scrollHeight;
    } else {
      // The game's box holds two lines; when it scrolls, the last two are visible.
      var lines = page.split('\n');
      boxText.innerHTML = wordsHTML(lines.slice(-2).join('\n'));
      boxArrow.style.visibility = pageFinished() ? 'visible' : 'hidden';
      box.classList.toggle('kr-hidden', page.length === 0);
    }
  }

  function onWordTap(e) {
    var t = e.target.closest ? e.target.closest('.kr-w') : null;
    if (!t) return;
    var sentence = current ? plain(current.text).replace(/\n+/g, ' ') : t.closest('[data-s]') ? t.closest('[data-s]').getAttribute('data-s') : '';
    openWord(t.getAttribute('data-w'), sentence, t);
  }

  // ---------- pause / resume ----------
  var wasRunning = false;
  function pause() { wasRunning = !!window.emuIsRunning; window.emuIsRunning = false; }
  function resume() { if (wasRunning && window.uiCurrentMode === 'player' && window.emuIsGameLoaded) window.emuIsRunning = true; wasRunning = false; }
  function openSheet(html) { if (sheet.hidden) pause(); card.innerHTML = html; sheet.hidden = false; card.scrollTop = 0; }
  function closeSheet() {
    sheet.hidden = true; resume();
    Array.prototype.forEach.call(document.querySelectorAll('.kr-sel'), function (n) { n.classList.remove('kr-sel'); });
    if (current) renderPanel();
  }

  // ---------- word sheet ----------
  function openWord(raw, sentence, span) {
    var word = KRLookup.clean(raw);
    if (span) span.classList.add('kr-sel');
    openSheet('<p class="' + C.muted + '">Looking up…</p>');
    loadDict().then(function (d) { showWord(word, raw, sentence, KRLookup.lookup(d, raw, 3)); })
      .catch(function () { showWord(word, raw, sentence, null); });
  }

  function showWord(word, raw, sentence, hits) {
    var savedNow = isSaved(word), OUT = HI('arrow-top-right-on-square', 'size-4 text-zinc-400');
    var h = '<div class="flex items-center gap-3"><div class="kr-selectable flex-1 break-keep text-[30px] font-bold">' + esc(word) + '</div>' +
      '<button class="' + (savedNow ? C.saved : C.save) + '" data-act="save">' +
      (savedNow ? HI('star', 'size-5') + 'Saved' : HI('star-outline', 'size-5') + 'Save') + '</button></div>';
    if (hits === null) h += '<p class="mt-3 ' + C.muted + '">Dictionary not available offline yet. Use the links below.</p>';
    else if (!hits.length) h += '<p class="mt-3 ' + C.muted + '">Not in the offline dictionary. Try Naver below, or long‑press the word above → Look Up.</p>';
    else {
      h += '<div class="mt-3 ' + C.list + '">';
      hits.forEach(function (x) {
        h += '<div class="px-4 py-3"><p class="text-lg font-bold"><span class="kr-selectable">' + esc(x.word) + '</span>' +
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
      '<a class="' + C.btn + '" target="_blank" href="https://korean.dict.naver.com/koendict/#/search?query=' + encodeURIComponent(base) + '">Naver ' + OUT + '</a>' +
      (sentence ? '<a class="' + C.btn + '" target="_blank" href="https://papago.naver.com/?sk=ko&tk=en&st=' + encodeURIComponent(sentence) + '">Sentence ' + OUT + '</a>' : '') +
      '</div><button class="mt-2 ' + C.primary + '" data-act="close">' + HI('play', 'size-5') + 'Back to game</button>';
    card.onclick = null;
    openSheet(h);
    card.querySelector('[data-act=close]').onclick = closeSheet;
    card.querySelector('[data-act=save]').onclick = function () {
      if (isSaved(word)) {
        saved = saved.filter(function (x) { return x.w !== word && x.base !== word; });
        toast('Removed');
      } else {
        saved.push({ w: word, base: base, gloss: hits && hits[0] ? hits[0].gloss : '', s: sentence || '', t: Date.now() });
        toast('Saved: ' + base);
      }
      persist(); updatePill();
      showWord(word, raw, sentence, hits);
    };
  }

  // ---------- menu: saved words / recent text ----------
  function openMenu(tab) {
    var tb = function (id, label) { return '<button class="' + C.tab + '" data-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>'; };
    var h = '<div class="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">' + tb('now', 'Now') +
      tb('saved', HI('star', 'size-4 text-amber-500') + saved.length) + tb('recent', 'Recent') + '</div>';
    if (tab === 'now') {
      // Current dialogue (what has been typed so far), else the last finished message.
      var nowText = current ? plain(current.text.slice(0, current.shown)) : (history.length ? history[history.length - 1] : '');
      var full = current ? plain(current.text) : nowText;
      if (!nowText.trim()) h += '<p class="mt-4 ' + C.muted + '">No dialogue on screen right now. Older text is under Recent.</p>';
      else {
        h += '<div class="kr-now mt-4 ' + C.card + '" data-s="' + esc(full.replace(/\n+/g, ' ')) + '">' +
          wordsHTML(nowText.replace(/\n\n+/g, '\n')) + '</div>' +
          '<p class="mt-2 px-1 ' + C.muted + '">Tap a word to look it up.</p>';
      }
    } else if (tab === 'saved') {
      if (!saved.length) h += '<p class="mt-4 ' + C.muted + '">No saved words yet. Tap any word in the subtitles, then Save.</p>';
      else {
        h += '<div class="mt-4 ' + C.list + '">';
        saved.slice().reverse().forEach(function (x) {
          h += '<div class="flex items-start gap-2 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-bold">' + esc(x.base || x.w) +
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
      if (!lines.length && !otherText.length) h += '<p class="mt-4 ' + C.muted + '">Nothing yet. Talk to someone in the game.</p>';
      var block = function (arr) {
        return '<div class="mt-2 ' + C.list + '">' + arr.map(function (t) {
          var s1 = t.replace(/\n+/g, ' ');
          return '<div class="px-4 py-2.5 leading-relaxed" data-s="' + esc(s1) + '">' + wordsHTML(s1) + '</div>';
        }).join('') + '</div>';
      };
      if (lines.length) h += '<div class="mt-2">' + block(lines) + '</div>';
      if (otherText.length) h += '<p class="mt-4 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Other text on screen</p>' + block(otherText.slice().reverse().slice(0, 60));
    }
    h += '<button class="mt-4 ' + C.primary + '" data-act="close">' + HI('play', 'size-5') + 'Back to game</button>';
    openSheet(h);
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
      return [x.base || x.w, x.gloss, x.s, x.w].map(csvField).join(',');
    });
    var csv = '#separator:comma\n#columns:Korean,Meaning,Sentence,As seen\n' + rows.join('\n') + '\n';
    var name = 'pokemon-korean-words.csv';
    var file = null;
    try { file = new File([csv], name, { type: 'text/csv' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Korean words' }).catch(function () {});
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
  }
  function copyList() {
    var txt = saved.map(function (x) { return (x.base || x.w) + ' — ' + (x.gloss || '') + (x.s ? '\n   ' + x.s : ''); }).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Copied'); }, function () { toast('Copy failed'); });
  }

  function updatePill() { if (!settings.debug) pill.innerHTML = HI('language'); }
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.style.opacity = 1;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.style.opacity = 0; }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  loadSaved();
})();
