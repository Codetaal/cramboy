// Korean subtitle + vocabulary overlay for DS Player.
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
  var settings = { subs: true, debug: /krdebug/.test(location.search) };
  var frame = 0, views = null, hideTimer = null, current = null;

  // ---------- DOM ----------
  var panel = el('div', { id: 'kr-panel', className: 'kr-hidden' });
  var textBox = el('div', { className: 'kr-text' });
  var menuBtn = el('button', { className: 'kr-menu-btn', textContent: '★' });
  panel.appendChild(textBox); panel.appendChild(menuBtn);
  var pill = el('button', { id: 'kr-pill', textContent: '가' });
  var sheet = el('div', { id: 'kr-sheet', hidden: true });
  var card = el('div', { className: 'kr-card' });
  sheet.appendChild(card);
  var toastEl = el('div', { id: 'kr-toast', style: 'opacity:0' });

  function mount() {
    var player = document.getElementById('player') || document.body;
    player.appendChild(panel); player.appendChild(pill);
    document.body.appendChild(sheet); document.body.appendChild(toastEl);
    // The emulator's window-level touch handler swallows every touch while the game runs.
    // Stop our touches from reaching it so taps and scrolling work here.
    [panel, pill, sheet].forEach(function (n) {
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
        n.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
      });
      n.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    });
    textBox.addEventListener('click', onWordTap);
    menuBtn.addEventListener('click', function () { openMenu('saved'); });
    pill.addEventListener('click', function () { openMenu('now'); });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    krLayout();
  }

  function el(tag, props) { var n = document.createElement(tag); for (var k in props) n[k] = props[k]; return n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function plain(s) { return s.replace(/​/g, '').replace(/·+/g, '…'); }

  // ---------- storage ----------
  function setSubs(v) {
    settings.subs = !!v;
    if (store) store.setItem('settings', { subs: settings.subs }).catch(function () {});
    if (current && settings.subs) renderPanel(); else setPanelVisible(false);
  }
  window.KRReaderStats = function () { return reader.stats; };
  window.KRSettings = { getSubs: function () { return settings.subs; }, setSubs: setSubs };

  function loadSaved() {
    if (!store) return;
    store.getItem('saved').then(function (v) { if (Array.isArray(v)) saved = v; updatePill(); }).catch(function () {});
    store.getItem('settings').then(function (v) { if (v) settings.subs = v.subs !== false; }).catch(function () {});
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
    panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
    panel.style.width = r.width + 'px'; panel.style.maxHeight = Math.round(r.height * 0.5) + 'px';
    pill.style.left = (r.left + 6) + 'px'; pill.style.top = (r.top + 6) + 'px';
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

  function renderPanel() {
    if (!current || !settings.subs) { setPanelVisible(false); return; }
    // Trailing breaks (White ends each message with a page break) don't start a new page yet.
    var shown = plain(current.text.slice(0, current.shown)).replace(/\n+$/, '');
    // Show only the current box page: text after the last blank line.
    var pages = shown.split('\n\n');
    var page = pages[pages.length - 1].replace(/^\n+/, '');
    textBox.innerHTML = wordsHTML(page);
    setPanelVisible(page.length > 0);
    panel.scrollTop = panel.scrollHeight;
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
    openSheet('<div class="kr-muted">Looking up…</div>');
    loadDict().then(function (d) { showWord(word, raw, sentence, KRLookup.lookup(d, raw, 3)); })
      .catch(function () { showWord(word, raw, sentence, null); });
  }

  function showWord(word, raw, sentence, hits) {
    var savedNow = isSaved(word);
    var h = '<div class="kr-head"><div class="kr-word kr-selectable">' + esc(word) + '</div>' +
      '<button class="kr-btn ' + (savedNow ? 'kr-on' : 'kr-primary') + '" data-act="save">' + (savedNow ? '★ Saved' : '☆ Save') + '</button></div>';
    if (hits === null) h += '<div class="kr-muted">Dictionary not available offline yet. Use the links below.</div>';
    else if (!hits.length) h += '<div class="kr-muted">Not in the offline dictionary. Try Naver below, or long‑press the word above → Look Up.</div>';
    else hits.forEach(function (x) {
      h += '<div class="kr-hit"><b class="kr-selectable">' + esc(x.word) + '</b>' +
        (x.how ? '<small>' + esc(x.how) + '</small>' : '') + '<div class="kr-gloss">' + esc(x.gloss) + '</div></div>';
    });
    if (sentence) {
      var marked = esc(sentence).split(esc(raw)).join('<mark>' + esc(raw) + '</mark>');
      h += '<div class="kr-sentence kr-selectable">' + marked + '</div>';
    }
    var base = hits && hits[0] ? hits[0].word : word;
    h += '<div class="kr-row">' +
      '<a class="kr-btn" target="_blank" href="https://korean.dict.naver.com/koendict/#/search?query=' + encodeURIComponent(base) + '">Naver ↗</a>' +
      (sentence ? '<a class="kr-btn" target="_blank" href="https://papago.naver.com/?sk=ko&tk=en&st=' + encodeURIComponent(sentence) + '">Sentence ↗</a>' : '') +
      '</div><div class="kr-row"><button class="kr-btn kr-primary" data-act="close">▶ Back to game</button></div>';
    card.onclick = null;
    openSheet(h);
    card.querySelector('[data-act=close]').onclick = closeSheet;
    card.querySelector('[data-act=save]').onclick = function () {
      if (isSaved(word)) {
        saved = saved.filter(function (x) { return x.w !== word && x.base !== word; });
        toast('Removed');
      } else {
        saved.push({ w: word, base: base, gloss: hits && hits[0] ? hits[0].gloss : '', s: sentence || '', t: Date.now() });
        toast('Saved ★ ' + base);
      }
      persist(); updatePill();
      showWord(word, raw, sentence, hits);
    };
  }

  // ---------- menu: saved words / recent text ----------
  function openMenu(tab) {
    var tabs = '<div class="kr-tabs">' +
      '<button class="kr-btn' + (tab === 'now' ? ' kr-on' : '') + '" data-tab="now">Now</button>' +
      '<button class="kr-btn' + (tab === 'saved' ? ' kr-on' : '') + '" data-tab="saved">★ ' + saved.length + '</button>' +
      '<button class="kr-btn' + (tab === 'recent' ? ' kr-on' : '') + '" data-tab="recent">Recent</button>' +
      '<button class="kr-btn' + (tab === 'settings' ? ' kr-on' : '') + '" data-tab="settings">⚙</button></div>';
    var h = tabs;
    if (tab === 'now') {
      // Current dialogue (what has been typed so far), else the last finished message.
      var nowText = current ? plain(current.text.slice(0, current.shown)) : (history.length ? history[history.length - 1] : '');
      var full = current ? plain(current.text) : nowText;
      if (!nowText.trim()) h += '<div class="kr-muted">No dialogue on screen right now. Older text is under Recent.</div>';
      else {
        h += '<div class="kr-now kr-tap" data-s="' + esc(full.replace(/\n+/g, ' ')) + '">' +
          wordsHTML(nowText.replace(/\n\n+/g, '\n')) + '</div>' +
          '<div class="kr-muted" style="margin-top:8px">Tap a word to look it up.</div>';
      }
    } else if (tab === 'saved') {
      if (!saved.length) h += '<div class="kr-muted">No saved words yet. Tap any word in the subtitles, then ☆ Save.</div>';
      saved.slice().reverse().forEach(function (x) {
        h += '<div class="kr-item"><div><b>' + esc(x.base || x.w) + '</b>' + (x.base && x.base !== x.w ? ' <span class="kr-muted">' + esc(x.w) + '</span>' : '') +
          '<div class="kr-gloss">' + esc(x.gloss || '—') + '</div>' +
          (x.s ? '<div class="kr-muted">' + esc(x.s) + '</div>' : '') + '</div>' +
          '<button class="kr-btn kr-x" data-del="' + x.t + '">✕</button></div>';
      });
      if (saved.length) h += '<div class="kr-row"><button class="kr-btn" data-act="export">Export for Anki (CSV)</button><button class="kr-btn" data-act="copy">Copy list</button></div>';
    } else if (tab === 'recent') {
      var lines = history.slice().reverse();
      if (current) lines.unshift(plain(current.text));
      if (!lines.length && !otherText.length) h += '<div class="kr-muted">Nothing yet. Talk to someone in the game.</div>';
      lines.forEach(function (t) {
        var s = t.replace(/\n+/g, ' ');
        h += '<div class="kr-line kr-tap" data-s="' + esc(s) + '">' + wordsHTML(t.replace(/\n+/g, ' ')) + '</div>';
      });
      if (otherText.length) {
        h += '<div class="kr-muted" style="margin-top:14px">Other text on screen (menus, descriptions)</div>';
        otherText.slice().reverse().slice(0, 60).forEach(function (t) {
          var s = t.replace(/\n+/g, ' ');
          h += '<div class="kr-line kr-tap" data-s="' + esc(s) + '">' + wordsHTML(s) + '</div>';
        });
      }
    } else {
      h += '<div class="kr-muted">The subtitle bar can be switched on or off in the game menu (☰).</div>' +
        '<div class="kr-muted" style="margin-top:12px">Reader: ' + reader.stats.strings + ' strings in memory, ' + reader.stats.korean + ' Korean, ' +
        reader.stats.printers + ' being printed.<br>Dictionary: ' + (dict ? Object.keys(dict).length.toLocaleString() + ' entries' : 'loads on first lookup') +
        '.<br>Character table and Pokémon names from PKHeX (GPL‑3.0); dictionary from kengdic (MPL‑2.0).</div>';
    }
    h += '<div class="kr-row"><button class="kr-btn kr-primary" data-act="close">▶ Back to game</button></div>';
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
      if (act === 'subs') { setSubs(!settings.subs); return openMenu('settings'); }
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

  function updatePill() { if (!settings.debug) pill.textContent = saved.length ? '가 ★' + saved.length : '가'; }
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.style.opacity = 1;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.style.opacity = 0; }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  loadSaved();
})();
