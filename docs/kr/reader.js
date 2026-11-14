// Korean / Japanese text reader for Pokémon Gen 4 (HeartGold/SoulSilver, D/P/Pt) and Gen 5 (Black/White).
// Finds live in-game String objects in DS main RAM and works out which one the
// text printer is currently typing, by looking for a pointer into its characters.
(function (root) {
  'use strict';

  // Both generations use the same string object ("strbuf"): u16 maxLen, u16 len, u32 magic, u16 text[].
  var STRING_MAGIC = 0xB6F8D2EC;   // pret/pokeheartgold src/pm_string.c; same value in Pokémon White
  var RAM_WORDS = 1 << 20;          // 4 MB main RAM = 1M 32-bit words
  var MAX_CAPACITY = 8192, MAX_LEN = 2048;
  // Text shown all at once (signs) has no typing cursor. It is told apart from labels and names by
  // its buffer: the game prints messages from big message buffers (HeartGold: 1024 characters),
  // while labels sit in buffers just big enough for their few letters.
  var MESSAGE_BUFFER = 256, INSTANT_SCANS = 2;
  // Gen 4 shows the place name in a banner when you enter a town or route ("연두마을"); the game
  // keeps it in its own 22-character buffer (checked on a HeartGold memory snapshot).
  var PLACE_BUFFER = 22;

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
    this.known = new Map(); this.current = null;
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
      var s = { addr: (i - 1) * 4, dataByte: dataHalf * 2, size: size, maxsize: maxsize, cursor: -1, mode: mode };
      list.push(s);
      var w0 = (s.dataByte >> 2), w1 = ((s.dataByte + size * 2) >> 2);
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
        if (!o) continue;
        var st = list[o - 1];
        var rel = off - st.dataByte;
        // rel 0 = pointer to the start of the text, used all over the place; the
        // printer cursor has moved past the first character.
        if (rel <= 0 || rel > st.size * 2 || (rel & 1)) continue;
        // Ignore the word right before the string (heap headers) and the string's own body.
        if (i * 4 >= st.addr - 16 && i * 4 < st.dataByte + st.size * 2) continue;
        var cur = rel >> 1;
        if (cur > st.cursor) { if (st.cursor < 0) printers++; st.cursor = cur; }
      }
    }
    this.stats.printers = printers;

    // 3) Track newly seen strings (for the "recent text" list) and pick the active dialogue.
    var seenNow = new Map(), fresh = [], best = null;
    for (i = 0; i < list.length; i++) {
      var s2 = list[i];
      var key = codesKey(u16, s2.dataByte >> 1, s2.size);
      var prev = this.known.get(s2.addr);
      var isNew = !prev || prev.key !== key;
      var rec = isNew ? { key: key, firstSeen: this.scanNo, cur0: -1, moved: false, quiet: 0, hadCursor: false } : prev;
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
      // Shown all at once (a sign): a message buffer that has gone two scans without ever having a
      // cursor. (A new dialogue has no cursor for a moment before typing starts; waiting two scans
      // keeps it from flashing up in full.) It counts as printed to the end.
      if (s2.cursor >= 0) { rec.hadCursor = true; rec.quiet = 0; } else rec.quiet++;
      var instant = s2.cursor < 0 && !rec.hadCursor && s2.maxsize >= MESSAGE_BUFFER && rec.quiet >= INSTANT_SCANS;
      if (instant) s2.cursor = s2.size;
      if (s2.cursor >= 0 && (rec.moved || instant || s2.cursor >= s2.size - 1)) {
        // Prefer the most recently created string that is being printed. Strings created at the
        // same moment are usually two copies of one message (Gen 5 keeps a raw and a printed copy,
        // and only the printed one's pointer is the live cursor): take the one printed furthest.
        if (!best || s2.firstSeen > best.firstSeen ||
            (s2.firstSeen === best.firstSeen && s2.cursor / s2.size > best.cursor / best.size)) best = s2;
      }
    }
    this.known = seenNow;

    var result = { fresh: [], active: null, changed: false, place: null };
    for (i = 0; i < fresh.length; i++) {
      var d = this.decode(u16, fresh[i].dataByte >> 1, fresh[i].size, fresh[i].mode);
      result.fresh.push(d.text);
      // A new place-name banner: one short line in the place buffer.
      if (fresh[i].mode === G4 && fresh[i].maxsize === PLACE_BUFFER && d.text.length >= 2 && d.text.indexOf('\n') < 0) result.place = d.text.replace(/\u200B/g, '').trim();
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
