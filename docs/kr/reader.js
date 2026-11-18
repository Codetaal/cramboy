// Korean / Japanese text reader for Pokémon Gen 4 (HeartGold/SoulSilver, D/P/Pt) and Gen 5 (Black/White).
// Finds live in-game String objects in DS main RAM and works out which one the
// text printer is currently typing, by looking for a pointer into its characters.
(function (root) {
  'use strict';

  // Both generations use the same string object ("strbuf"): u16 maxLen, u16 len, u32 magic, u16 text[].
  var STRING_MAGIC = 0xB6F8D2EC;   // pret/pokeheartgold src/pm_string.c; same value in Pokémon White
  var RAM_WORDS = 1 << 20;          // 4 MB main RAM = 1M 32-bit words
  var MAX_CAPACITY = 8192, MAX_LEN = 2048;

  // Gen 4: own character table, Hangul at 0x400-0xD65.
  var G4_HANGUL_MIN = 0x400, G4_HANGUL_MAX = 0xD65;
  var G4_NEWLINE = 0xE000, G4_SCROLL = 0x25BC, G4_PAGE = 0x25BD, G4_CTRL = 0xFFFE;
  // Gen 5: Unicode text. 0xFFFE = new line, 0xF000 = command (BE00 scroll, BE01 new page).
  var UNI_HANGUL_MIN = 0xAC00, UNI_HANGUL_MAX = 0xD7A3;
  // Japanese: kana (and kanji in Gen 5). In Gen 4 the kana sit at the start of the game's table.
  var UNI_KANA_MIN = 0x3041, UNI_KANA_MAX = 0x30FF, UNI_KANJI_MIN = 0x4E00, UNI_KANJI_MAX = 0x9FFF;
  var G5_NEWLINE = 0xFFFE, G5_CTRL = 0xF000, G5_SCROLL = 0xBE00, G5_PAGE = 0xBE01;
  var EOS = 0xFFFF;
  var G4 = 1, G5 = 2;

  function Reader(table, lang) {
    this.table = table;                 // string: code -> char ('\0' = unknown)
    this.setLang(lang || 'ko');
    this.owner = new Int32Array(RAM_WORDS);
    this.marked = [];                   // owner[] slots to clear next scan
    this.known = new Map();             // addr -> {text, firstSeen}
    this.scanNo = 0;
    this.current = null;                // {addr, text, codesKey, chars, cursor}
    this.stats = { strings: 0, korean: 0, printers: 0 };
  }

  // 'ko' (Hangul) or 'ja' (kana / kanji): which strings count as game text.
  Reader.prototype.setLang = function (lang) {
    this.lang = lang === 'ja' ? 'ja' : 'ko';
    if (this.lang === 'ja' && !this.g4Kana) {
      this.g4Kana = new Uint8Array(this.table.length);
      for (var i = 0; i < this.table.length; i++) {
        var x = this.table.charCodeAt(i);
        if (x >= UNI_KANA_MIN && x <= UNI_KANA_MAX) this.g4Kana[i] = 1;
      }
    }
    this.known = new Map(); this.current = null; this.g4Printer = false;
  };

  // Decode a run of 16-bit codes into display text.
  // Returns {text, pos} where pos[k] = source code index of text[k].
  Reader.prototype.decode = function (u16, start, len, mode) {
    if (!mode) mode = this.textMode(u16, start, len) || G4;
    var t = this.table, out = [], pos = [];
    for (var i = 0; i < len; i++) {
      var c = u16[start + i];
      if (c === EOS) break;
      if (mode === G5) {
        if (c === G5_NEWLINE) { out.push('\n'); pos.push(i); continue; }
        if (c === G5_CTRL) {
          var cmd = u16[start + i + 1], n5 = u16[start + i + 2];
          if (n5 > 16) break;
          if (cmd === G5_PAGE) { out.push('\n', '\n'); pos.push(i, i); }
          else if (cmd === G5_SCROLL) { out.push('\n'); pos.push(i); }
          else { out.push('\u200B'); pos.push(i); }
          i += 2 + n5;
          continue;
        }
        if (c >= 0xE000 && c <= 0xF8FF) { out.push('·'); pos.push(i); continue; } // private-use symbols
        out.push(String.fromCharCode(c)); pos.push(i);
        continue;
      }
      if (c === G4_CTRL) {
        var n = u16[start + i + 2];
        if (n > 16) break;                       // garbage: stop
        out.push('\u200B'); pos.push(i);        // keep an index anchor
        i += 2 + n;
        continue;
      }
      if (c === G4_NEWLINE || c === G4_SCROLL) { out.push('\n'); pos.push(i); continue; }
      if (c === G4_PAGE) { out.push('\n', '\n'); pos.push(i, i); continue; }
      var ch = c < t.length ? t.charAt(c) : '\0';
      if (ch === '\0') { out.push('·'); pos.push(i); continue; }
      out.push(ch); pos.push(i);
    }
    return { text: out.join(''), pos: pos };
  };

  // Which encoding a string uses, judged by its Korean or Japanese characters:
  // G5 (Unicode), G4 (game table) or 0 (no text in the game's language).
  Reader.prototype.textMode = function (u16, start, len) {
    var g4 = false, i, c;
    if (this.lang === 'ja') {
      var kana = this.g4Kana, n = kana.length;
      for (i = 0; i < len; i++) {
        c = u16[start + i];
        if ((c >= UNI_KANA_MIN && c <= UNI_KANA_MAX) || (c >= UNI_KANJI_MIN && c <= UNI_KANJI_MAX)) return G5;
        if (c < n && kana[c]) g4 = true;
      }
      return g4 ? G4 : 0;
    }
    for (i = 0; i < len; i++) {
      c = u16[start + i];
      if (c >= UNI_HANGUL_MIN && c <= UNI_HANGUL_MAX) return G5;
      if (c >= G4_HANGUL_MIN && c <= G4_HANGUL_MAX) g4 = true;
    }
    return g4 ? G4 : 0;
  };

  // u32/u16: typed views over the 4 MB main RAM (same buffer, word/halfword).
  Reader.prototype.scan = function (u32, u16) {
    this.scanNo++;
    var owner = this.owner, list = [], i;

    // Clear owner marks from the previous scan.
    for (i = 0; i < this.marked.length; i++) owner[this.marked[i]] = 0;
    this.marked.length = 0;

    // 1) Find live String objects with text in the game's language.
    var total = 0;
    for (i = 1; i < RAM_WORDS - 2; i++) {
      if (u32[i] !== STRING_MAGIC) continue;
      var hdr = u32[i - 1];
      var maxsize = hdr & 0xFFFF, size = hdr >>> 16;
      if (size === 0 || size > maxsize || maxsize > MAX_CAPACITY || size > MAX_LEN) continue;
      var dataHalf = (i + 1) * 2;
      if (dataHalf + size >= RAM_WORDS * 2) continue;
      total++;
      var mode = this.textMode(u16, dataHalf, size);
      if (!mode) continue;
      var s = { addr: (i - 1) * 4, dataByte: dataHalf * 2, size: size, cursor: -1, pcursor: -1, mode: mode, hrefs: null };
      list.push(s);
      // (the header word too: pointers to the String object itself, see the message-box check below)
      var w0 = (s.dataByte >> 2) - 2, w1 = ((s.dataByte + size * 2) >> 2);
      for (var w = w0; w <= w1; w++) { owner[w] = list.length; this.marked.push(w); }
    }
    this.stats.strings = total;
    this.stats.korean = list.length;

    // 2) Find pointers that land inside a Korean string's characters:
    //    the text printer's "current character" cursor.
    var printers = 0;
    if (list.length) {
      for (i = 0; i < RAM_WORDS; i++) {
        var v = u32[i];
        if ((v & 0xFF000000) !== 0x02000000) continue;
        var off = v & 0x3FFFFF;
        var o = owner[off >> 2];
        // A Gen 4 printer that has finished a message points one past its end mark (where nothing else of
        // ours lives); only then is a pointer just outside a string its cursor.
        if (!o) {
          var o2 = owner[(off - 2) >> 2];
          if (!o2) continue;
          var st2 = list[o2 - 1];
          if (off - st2.dataByte !== st2.size * 2 + 2 || !isG4Printer(u32, i)) continue;
          if (st2.cursor < 0) printers++;
          st2.cursor = st2.size; st2.pcursor = st2.size;
          continue;
        }
        var st = list[o - 1];
        var rel = off - st.dataByte;
        if (rel === -8) { (st.hrefs || (st.hrefs = [])).push(i); continue; }   // points at the String object
        // rel 0 = pointer to the start of the text, used all over the place; the
        // printer cursor has moved past the first character.
        // (rel = size + 1 characters: a finished printer, one past the end mark; see above)
        if (rel <= 0 || rel > st.size * 2 + 2 || (rel & 1)) continue;
        if (rel === st.size * 2 + 2 && !isG4Printer(u32, i)) continue;
        // Ignore the word right before the string (heap headers) and the string's own body.
        if (i * 4 >= st.addr - 16 && i * 4 < st.dataByte + st.size * 2) continue;
        var cur = Math.min(rel >> 1, st.size);
        if (cur > st.cursor) { if (st.cursor < 0) printers++; st.cursor = cur; }
        // Gen 4 text printer: its "current character" word is followed by a pointer to the dialogue
        // Window. Other pointers into the text (end-of-text markers, line tables) can run ahead of
        // what is on screen, so the printer's own cursor wins when there is one.
        if (isG4Printer(u32, i) && cur > st.pcursor) st.pcursor = cur;
        else if (notDialoguePrinter(u32, i)) st.notDialogue = true;
      }
      for (i = 0; i < list.length; i++) if (list[i].pcursor > 0) { list[i].cursor = list[i].pcursor; this.g4Printer = true; }
    }
    this.stats.printers = printers;

    // 3) Track newly seen strings (for the "recent text" list) and pick the active dialogue.
    var seenNow = new Map(), fresh = [], best = null;
    for (i = 0; i < list.length; i++) {
      var s2 = list[i];
      var key = codesKey(u16, s2.dataByte >> 1, s2.size);
      var prev = this.known.get(s2.addr);
      var isNew = !prev || prev.key !== key;
      var rec = isNew ? { key: key, firstSeen: this.scanNo, cur0: -1, moved: false } : prev;
      seenNow.set(s2.addr, rec);
      s2.key = key; s2.firstSeen = rec.firstSeen;
      if (isNew && this.scanNo > 1) fresh.push(s2);
      // Only text that is really being typed counts as dialogue: its cursor has moved since we first
      // saw it, or it is already printed to the end. Labels on the touch screen (HeartGold's "조사한다"
      // button) also have a pointer into their text, but it never moves.
      if (s2.cursor >= 0) {
        if (rec.cur0 < 0) rec.cur0 = s2.cursor;
        else if (s2.cursor !== rec.cur0) rec.moved = true;
      }
      // A Gen 4 text printer's own cursor is dialogue too, even if it hasn't moved since we first saw it:
      // after resuming, the game can be waiting on a page (▼) and only moves on when you press A.
      // Once the game has shown it types dialogue with Gen 4 printers, a new Gen 4 message only counts when
      // such a printer is typing it: menu labels on the touch screen ("포켓기어") also have moving pointers.
      var unprinted = s2.mode === G4 && s2.pcursor <= 0 && (this.g4Printer || s2.notDialogue) && !(this.current && this.current.key === key);
      if (s2.cursor >= 0 && !unprinted && (rec.moved || s2.cursor >= s2.size - 1 || s2.pcursor > 0)) {
        // Prefer the most recently created string that is being printed. Strings created at the
        // same moment are usually two copies of one message (Gen 5 keeps a raw and a printed copy,
        // and only the printed one's pointer is the live cursor): take the one printed furthest.
        if (!best || s2.firstSeen > best.firstSeen ||
            (s2.firstSeen === best.firstSeen && s2.cursor / s2.size > best.cursor / best.size)) best = s2;
      }
    }
    this.known = seenNow;

    // No printer at work, but a message box on screen (HeartGold / SoulSilver): after resuming, a message
    // that has been typed to the end waits for A with no printer left. The field message box keeps its
    // Window and, 0x34 bytes further, a pointer to the String it shows; the Window only exists while the
    // box is open. That message is shown in full.
    if (!best) {
      for (i = 0; i < list.length; i++) {
        var s3 = list[i];
        if (s3.mode !== G4 || !s3.hrefs) continue;
        for (var h = 0; h < s3.hrefs.length; h++) {
          var wi = s3.hrefs[h] - 13;
          if (wi >= 0 && isTopWindow(u32, wi)) { best = s3; best.cursor = s3.size; break; }
        }
        if (best) break;
      }
    }
    // A sign you walk up against (HeartGold / SoulSilver: "여기는 연두마을") shows its text at once, with no
    // printer. While it is up the game keeps the sign's text twice (raw and expanded), pointed to from two
    // words side by side; both are freed when you walk away.
    if (!best) {
      var hrefOf = new Map();
      for (i = 0; i < list.length; i++) if (list[i].mode === G4 && list[i].hrefs) list[i].hrefs.forEach(function (h) { hrefOf.set(h, i); });
      hrefOf.forEach(function (si, h) {
        var other = hrefOf.get(h + 1);
        if (best || other === undefined || other === si) return;
        var a = list[si], b = list[other];
        if (a.size !== b.size || codesKey(u16, a.dataByte >> 1, a.size) !== codesKey(u16, b.dataByte >> 1, b.size)) return;
        best = a; best.cursor = a.size;
      });
    }

    var result = { fresh: [], active: null, changed: false };
    for (i = 0; i < fresh.length; i++) {
      var d = this.decode(u16, fresh[i].dataByte >> 1, fresh[i].size, fresh[i].mode);
      result.fresh.push(d.text);
    }

    if (best) {
      var dec = this.decode(u16, best.dataByte >> 1, best.size, best.mode);
      // Number of characters already printed.
      var shown = 0;
      while (shown < dec.pos.length && dec.pos[shown] < best.cursor) shown++;
      var prevCur = this.current;
      // Same message if the text is the same, even if the other copy is the one being followed.
      var same = prevCur && prevCur.key === best.key;
      this.current = { addr: best.addr, key: best.key, text: dec.text, shown: shown };
      result.changed = !same || prevCur.shown !== shown;
      result.newMessage = !same;
    } else if (this.current && !this.known.has(this.current.addr)) {
      // Message string was freed: the dialogue box closed.
      this.current = null;
      result.changed = true;
      result.closed = true;
    }
    result.active = this.current;
    return result;
  };

  // Is the word at u32[i] the cursor of a Gen 4 TextPrinter on the top screen? Its next word points to a
  // Window: {bgConfig*, u8 bgId, tilemapLeft, tilemapTop, width, height, ...} on the 32x24-tile screen.
  // A freed heap block (NNS "RF" header 0x20 bytes before the printer) is a leftover, not a printer.
  // A Window on the top screen at word wi: bgConfig pointer, bg 0-3, size on the 32x24-tile screen, pixel buffer.
  function isTopWindow(u32, wi) {
    if (wi + 3 >= RAM_WORDS || (u32[wi] & 0xFF000003) !== 0x02000000 || (u32[wi + 3] & 0xFF000000) !== 0x02000000) return false;
    var b = u32[wi + 1], bg = b & 0xFF, left = (b >>> 8) & 0xFF, top = (b >>> 16) & 0xFF, width = b >>> 24, height = u32[wi + 2] & 0xFF;
    return bg <= 3 && width > 0 && height > 0 && left + width <= 32 && top + height <= 24;
  }
  // The Window a Gen 4 printer's cursor at u32[i] prints into, or null: {bg, top}.
  function printerWindow(u32, i) {
    var w = u32[i + 1];
    if ((w & 0xFF000003) !== 0x02000000) return null;
    var wi = (w & 0x3FFFFF) >> 2;
    if (wi + 2 >= RAM_WORDS || (u32[wi] & 0xFF000000) !== 0x02000000) return null;
    var b = u32[wi + 1], bg = b & 0xFF, left = (b >>> 8) & 0xFF, top = (b >>> 16) & 0xFF, width = b >>> 24;
    var height = u32[wi + 2] & 0xFF;
    if (bg > 7 || !width || !height || left + width > 32 || top + height > 24) return null;
    if (i >= 8 && (u32[i - 8] & 0xFFFF) === 0x4652) return null;
    return { bg: bg, top: top };
  }
  // Printed somewhere that is not a dialogue box: the touch screen (labels like "조사한다", "포켓기어") or the
  // very top of the top screen (the town-name banner, "연두마을"). Such text never becomes a subtitle.
  function notDialoguePrinter(u32, i) {
    var w = printerWindow(u32, i);
    return !!w && (w.bg > 3 || w.top < 10);
  }
  function isG4Printer(u32, i) {
    var w = u32[i + 1];
    if ((w & 0xFF000003) !== 0x02000000) return false;
    var wi = (w & 0x3FFFFF) >> 2;
    if (wi + 2 >= RAM_WORDS || (u32[wi] & 0xFF000000) !== 0x02000000) return false;
    var b = u32[wi + 1], bg = b & 0xFF, left = (b >>> 8) & 0xFF, top = (b >>> 16) & 0xFF, width = b >>> 24;
    var height = u32[wi + 2] & 0xFF;
    // bg 0-3 is the top screen, 4-7 the touch screen. Dialogue is on the top screen; the touch screen's
    // printed labels ("조사한다" on the A button) are not dialogue.
    if (bg > 3 || !width || !height || left + width > 32 || top + height > 24) return false;
    // Dialogue boxes sit in the lower part of the top screen (row 19 in HeartGold); the town-name banner
    // that pops up when you enter a place is at the very top (row 0) and is not dialogue.
    if (top < 10) return false;
    if (i >= 8 && (u32[i - 8] & 0xFFFF) === 0x4652) return false;
    return true;
  }

  function codesKey(u16, start, len) {
    // Cheap hash of the string's codes so we notice edits in place.
    var h = 2166136261 >>> 0;
    for (var i = 0; i < len; i++) { h ^= u16[start + i]; h = Math.imul(h, 16777619) >>> 0; }
    return len + ':' + h;
  }

  Reader.STRING_MAGIC = STRING_MAGIC;
  if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
  else root.KRReader = Reader;
})(this);
