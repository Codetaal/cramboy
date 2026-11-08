// Korean text reader for Pokémon HeartGold/SoulSilver (and other Gen 4 games).
// Finds live in-game String objects in DS main RAM and works out which one the
// text printer is currently typing, by looking for a pointer into its characters.
(function (root) {
  'use strict';

  var STRING_MAGIC = 0xB6F8D2EC;   // pret/pokeheartgold src/pm_string.c
  var RAM_WORDS = 1 << 20;          // 4 MB main RAM = 1M 32-bit words
  var MAX_STRING = 1024;            // longest message we accept (chars)

  var HANGUL_MIN = 0x400, HANGUL_MAX = 0xD65;
  var NEWLINE = 0xE000, SCROLL = 0x25BC, PAGE = 0x25BD, CTRL = 0xFFFE, EOS = 0xFFFF;

  function Reader(table) {
    this.table = table;                 // string: code -> char ('\0' = unknown)
    this.owner = new Int32Array(RAM_WORDS);
    this.marked = [];                   // owner[] slots to clear next scan
    this.known = new Map();             // addr -> {text, firstSeen}
    this.scanNo = 0;
    this.current = null;                // {addr, text, codesKey, chars, cursor}
    this.stats = { strings: 0, korean: 0, printers: 0 };
  }

  // Decode a run of 16-bit codes into display text.
  // Returns {text, pos} where pos[k] = source code index of text[k].
  Reader.prototype.decode = function (u16, start, len) {
    var t = this.table, out = [], pos = [];
    for (var i = 0; i < len; i++) {
      var c = u16[start + i];
      if (c === EOS) break;
      if (c === CTRL) {
        var n = u16[start + i + 2];
        if (n > 16) break;                       // garbage: stop
        out.push('​'); pos.push(i);        // keep an index anchor
        i += 2 + n;
        continue;
      }
      if (c === NEWLINE || c === SCROLL) { out.push('\n'); pos.push(i); continue; }
      if (c === PAGE) { out.push('\n', '\n'); pos.push(i, i); continue; }
      var ch = c < t.length ? t.charAt(c) : '\0';
      if (ch === '\0') { out.push('·'); pos.push(i); continue; }
      out.push(ch); pos.push(i);
    }
    return { text: out.join(''), pos: pos };
  };

  function hasHangul(u16, start, len) {
    for (var i = 0; i < len; i++) {
      var c = u16[start + i];
      if (c >= HANGUL_MIN && c <= HANGUL_MAX) return true;
    }
    return false;
  }

  // u32/u16: typed views over the 4 MB main RAM (same buffer, word/halfword).
  Reader.prototype.scan = function (u32, u16) {
    this.scanNo++;
    var owner = this.owner, list = [], i;

    // Clear owner marks from the previous scan.
    for (i = 0; i < this.marked.length; i++) owner[this.marked[i]] = 0;
    this.marked.length = 0;

    // 1) Find live String objects with Korean text.
    var total = 0;
    for (i = 1; i < RAM_WORDS - 2; i++) {
      if (u32[i] !== STRING_MAGIC) continue;
      var hdr = u32[i - 1];
      var maxsize = hdr & 0xFFFF, size = hdr >>> 16;
      if (size === 0 || size > maxsize || maxsize > MAX_STRING) continue;
      var dataHalf = (i + 1) * 2;
      if (dataHalf + size >= RAM_WORDS * 2) continue;
      total++;
      if (!hasHangul(u16, dataHalf, size)) continue;
      var s = { addr: (i - 1) * 4, dataByte: dataHalf * 2, size: size, cursor: -1 };
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
      var rec = isNew ? { key: key, firstSeen: this.scanNo } : prev;
      seenNow.set(s2.addr, rec);
      s2.key = key; s2.firstSeen = rec.firstSeen;
      if (isNew && this.scanNo > 1) fresh.push(s2);
      if (s2.cursor >= 0) {
        // Prefer the most recently created string that is being printed.
        if (!best || s2.firstSeen > best.firstSeen ||
            (s2.firstSeen === best.firstSeen && s2.addr === (this.current && this.current.addr))) best = s2;
      }
    }
    this.known = seenNow;

    var result = { fresh: [], active: null, changed: false };
    for (i = 0; i < fresh.length; i++) {
      var d = this.decode(u16, fresh[i].dataByte >> 1, fresh[i].size);
      result.fresh.push(d.text);
    }

    if (best) {
      var dec = this.decode(u16, best.dataByte >> 1, best.size);
      // Number of characters already printed.
      var shown = 0;
      while (shown < dec.pos.length && dec.pos[shown] < best.cursor) shown++;
      var prevCur = this.current;
      var same = prevCur && prevCur.addr === best.addr && prevCur.key === best.key;
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
