// General text reader for DS games that are not Pokémon: finds Korean or Japanese text in main RAM in a
// standard encoding (UTF-16, Shift-JIS or EUC-KR) and works out which line the game is typing, by a
// pointer that moves through it (the same idea as the Pokémon reader, without Pokémon's own containers).
// Used by reader.js when a game has no Pokémon text at all.
(function (root) {
  'use strict';
  var RAM = 4 << 20, MIN_CHARS = 3, MAX_CHARS = 1500;

  // ---- what counts as text, per encoding ----
  function u16Target(c, lang) {
    if (lang === 'ja') return (c >= 0x3041 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF);
    return c >= 0xAC00 && c <= 0xD7A3;
  }
  // Characters that can sit inside a line: the language's own, CJK punctuation, full-width forms, ASCII,
  // line breaks. Anything else ends the run.
  function u16Text(c, lang) {
    return u16Target(c, lang) || (c >= 0x20 && c < 0x7F) || c === 0x0A || (c >= 0x3000 && c <= 0x303F) ||
      (c >= 0xFF01 && c <= 0xFF5E) || c === 0x2026 || c === 0x2025 || c === 0x2018 || c === 0x2019 || c === 0x201C || c === 0x201D ||
      (c >= 0x3041 && c <= 0x30FF) || (c >= 0x3131 && c <= 0x318E) || c === 0x00B7 || c === 0x2605 || c === 0x2606 || c === 0x266A;
  }
  // Game control codes that can sit between characters (colour, wait, new line in the game's own code):
  // 0x01-0x1F, the private use area and 0xFFFE. At most MAX_GAP in a row, so unrelated data doesn't join.
  var MAX_GAP = 4;
  function u16Gap(c) { return (c >= 1 && c < 0x20) || (c >= 0xE000 && c <= 0xF8FF) || c === 0xFFFE; }
  // 0 ends a string, except as an argument right after a command code (Pokémon: F000 BE01 0000).
  function gapAt(u16, k) { var c = u16[k]; return u16Gap(c) || (c === 0 && (u16[k - 1] >= 0xE000 && u16[k - 1] <= 0xF8FF || u16[k - 2] >= 0xE000 && u16[k - 2] <= 0xF8FF)); }
  function u16Ok(u16, k, lang) {
    if (u16Text(u16[k], lang)) return true;
    // a gap only counts if real text follows within MAX_GAP codes
    for (var g = 0; g < MAX_GAP && gapAt(u16, k + g); g++) if (u16Text(u16[k + g + 1], lang)) return true;
    return false;
  }
  // Shift-JIS: kana (0x829F-0x82F1 hiragana, 0x8340-0x8396 katakana) and kanji count as Japanese.
  // (symbols and kana 0x81-0x84, kanji 0x88-0x9F and 0xE0-0xEA; not the rarely used rest)
  function sjisPair(a, b) { return ((a >= 0x81 && a <= 0x84) || (a >= 0x88 && a <= 0x9F) || (a >= 0xE0 && a <= 0xEA)) && b >= 0x40 && b <= 0xFC && b !== 0x7F; }
  function sjisTarget(a, b) { return (a === 0x82 && b >= 0x9F && b <= 0xF1) || (a === 0x83 && b >= 0x40 && b <= 0x96) || (a >= 0x88 && a <= 0x9F) || (a >= 0xE0 && a <= 0xEA); }
  // EUC-KR / CP949: Hangul syllables 0xB0A1-0xC8FE.
  // (symbols 0xA1-0xA3 and Hangul only: Korean game text has no hanja, and binary code that happens to
  // decode as EUC-KR is full of them)
  function eucPair(a, b) { return ((a >= 0xA1 && a <= 0xA3) || (a >= 0xB0 && a <= 0xC8)) && b >= 0xA1 && b <= 0xFE; }
  function eucTarget(a, b) { return a >= 0xB0 && a <= 0xC8 && b >= 0xA1 && b <= 0xFE; }

  // Does a run look like real writing rather than a table of numbers that happens to fall in the Hangul or
  // kana range? Korean: nearly every syllable is one of the 2,350 common ones (KS X 1001, the EUC-KR set);
  // tables hit rare ones like 훺 or 뙽. Japanese: a good share of hiragana (particles, endings).
  var KS = null;
  function ksSet() {
    if (KS) return KS;
    KS = new Uint8Array(0xD7A4 - 0xAC00);
    var d = decoder('euc-kr'); if (!d) { KS.fill(1); return KS; }
    var b = new Uint8Array(2);
    for (var a = 0xB0; a <= 0xC8; a++) for (var c = 0xA1; c <= 0xFE; c++) {
      b[0] = a; b[1] = c; var ch = d.decode(b).charCodeAt(0);
      if (ch >= 0xAC00 && ch <= 0xD7A3) KS[ch - 0xAC00] = 1;
    }
    return KS;
  }
  function looksLikeText(str, lang) {
    var tgt = 0, good = 0, seen = {}, distinct = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (lang === 'ja') { if ((c >= 0x3041 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF)) { tgt++; if (c >= 0x3041 && c <= 0x309F) good++; } }
      else if (c >= 0xAC00 && c <= 0xD7A3) { tgt++; if (ksSet()[c - 0xAC00]) good++; }
    }
    for (var q = 0; q < str.length; q++) if (str.charCodeAt(q) > 0x3000 && !seen[str[q]]) { seen[str[q]] = 1; distinct++; }
    if (tgt < MIN_CHARS || distinct < 3) return false;
    // Korean puts spaces between words: seven syllables in a row with no space is a word list or a table.
    if (lang !== 'ja' && /[\uAC00-\uD7A3]{7}/.test(str)) return false;
    // A table counts upwards (가 괌 깹 끝 …): text goes up and down.
    var up = 0, pairs = 0;
    for (var k = 1; k < str.length; k++) { var x = str.charCodeAt(k - 1), y = str.charCodeAt(k); if (x > 0x3000 && y > 0x3000) { pairs++; if (y > x) up++; } }
    if (pairs >= 6 && up >= pairs * 0.85) return false;
    return lang === 'ja' ? good >= tgt * 0.2 : good >= tgt * 0.95;
  }

  var dec = {};
  function decoder(name) { try { return dec[name] || (dec[name] = new TextDecoder(name)); } catch (e) { return null; } }

  function GenericReader(lang) {
    this.lang = lang || 'ko';
    this.owner = new Int32Array(RAM >> 2);
    this.marked = [];
    this.known = new Map();
    this.scanNo = 0;
    this.current = null;
    this.stats = { strings: 0, korean: 0, printers: 0, generic: true };
  }

  // Runs of text: {start (byte), end (byte, exclusive), enc: 'u16' | 'sjis' | 'euc', chars}
  GenericReader.prototype.findRuns = function (u8, u16) {
    var runs = [], lang = this.lang, i, n, t, s;
    // UTF-16 (2-byte aligned)
    // (Japanese: a run starts at kana and counts kana only. Every line has some, and the kanji range is so
    // wide that plain data lands in it all the time.)
    var seed = lang === 'ja' ? function (c) { return c >= 0x3041 && c <= 0x30FA; } : function (c) { return u16Target(c, lang); };
    for (i = 0, n = RAM >> 1; i < n; i++) {
      if (!seed(u16[i])) continue;
      s = i; while (s > 0 && i - s < MAX_CHARS && u16Text(u16[s - 1], lang)) s--;
      t = 0; var e = s;
      while (e < n - MAX_GAP - 1 && e - s < MAX_CHARS && u16Ok(u16, e, lang)) { if (seed(u16[e])) t++; e++; }
      if (t >= MIN_CHARS) runs.push({ start: s * 2, end: e * 2, enc: 'u16', chars: e - s });
      i = e;
    }
    // Shift-JIS (Japanese) or EUC-KR (Korean), byte by byte
    var pair = lang === 'ja' ? sjisPair : eucPair, target = lang === 'ja' ? sjisTarget : eucTarget;
    for (i = 0; i < RAM - 1; i++) {
      if (!(pair(u8[i], u8[i + 1]) && target(u8[i], u8[i + 1]))) continue;
      var st = i, cnt = 0, tg = 0, j = i;
      while (j < RAM - 1 && cnt < MAX_CHARS) {
        var a = u8[j];
        if (pair(a, u8[j + 1])) { if (target(a, u8[j + 1])) tg++; j += 2; cnt++; }
        else if ((a >= 0x20 && a < 0x7F) || a === 0x0A) { j++; cnt++; }
        else break;
      }
      if (tg >= MIN_CHARS && u8[j] === 0) runs.push({ start: st, end: j, enc: lang === 'ja' ? 'sjis' : 'euc', chars: cnt });
      i = j;
    }
    return runs;
  };

  GenericReader.prototype.decode = function (u8, u16, run, upto) {
    var end = upto == null ? run.end : Math.min(run.end, upto);
    if (run.enc === 'u16') {
      var out = '';
      for (var i = run.start >> 1; i < end >> 1; i++) { var c = u16[i]; if (c === 0x0A || c === 0xFFFE) out += '\n'; else if (c && !u16Gap(c)) out += String.fromCharCode(c); }
      return out;
    }
    var d = decoder(run.enc === 'sjis' ? 'shift_jis' : 'euc-kr');
    return d ? d.decode(u8.subarray(run.start, end)) : '';
  };

  GenericReader.prototype.scan = function (u32, u16) {
    this.scanNo++;
    var u8 = new Uint8Array(u32.buffer, u32.byteOffset, RAM), owner = this.owner, i;
    for (i = 0; i < this.marked.length; i++) owner[this.marked[i]] = 0;
    this.marked.length = 0;

    var self = this, runs = this.findRuns(u8, u16);
    for (i = 0; i < runs.length; i++) {
      runs[i].cursor = -1;
      for (var w = runs[i].start >> 2; w <= (runs[i].end + 2) >> 2; w++) { owner[w] = i + 1; this.marked.push(w); }
    }
    // Pointers into a run's text (past its first character): the line being typed.
    for (i = 0; i < RAM >> 2; i++) {
      var v = u32[i];
      if ((v & 0xFF000000) !== 0x02000000) continue;
      var off = v & 0x3FFFFF, o = owner[off >> 2];
      if (!o) continue;
      var r = runs[o - 1];
      if (off <= r.start || off > r.end + 2 || (r.enc === 'u16' && ((off - r.start) & 1))) continue;
      if (i * 4 >= r.start - 16 && i * 4 < r.end) continue;          // its own bytes / header
      var at = Math.min(off, r.end);
      if (at > r.cursor) r.cursor = at;
    }
    // Only runs that something points into matter; check those look like real writing.
    runs = runs.filter(function (r) { return r.cursor >= 0 && looksLikeText(r.text = self.decode(u8, u16, r), self.lang); });
    this.stats.strings = this.stats.korean = this.stats.printers = runs.length;

    // Track runs over time: a cursor that moves, or sits at the end, is dialogue.
    var seenNow = new Map(), best = null;
    for (i = 0; i < runs.length; i++) {
      var q = runs[i], key = q.enc + ':' + q.text;
      var prev = this.known.get(q.start);
      var rec = prev && prev.key === key ? prev : { key: key, firstSeen: this.scanNo, cur0: -1, moved: false };
      seenNow.set(q.start, rec);
      q.key = key; q.firstSeen = rec.firstSeen;
      if (rec.cur0 < 0) rec.cur0 = q.cursor; else if (q.cursor !== rec.cur0) rec.moved = true;
      if (rec.moved || q.cursor >= q.end - 2) {
        if (!best || q.firstSeen > best.firstSeen || (q.firstSeen === best.firstSeen && q.end - q.start > best.end - best.start)) best = q;
      }
    }
    this.known = seenNow;

    var result = { fresh: [], active: null, changed: false };
    if (best) {
      var full = best.text, shownText = this.decode(u8, u16, best, best.cursor);
      var prevCur = this.current, same = prevCur && prevCur.key === best.key;
      this.current = { addr: best.start, end: best.end, enc: best.enc, key: best.key, text: full, shown: shownText.length };
      result.changed = !same || prevCur.shown !== this.current.shown;
      result.newMessage = !same;
    } else if (this.current && this.current.enc + ':' + this.decode(u8, u16, { start: this.current.addr, end: this.current.end, enc: this.current.enc }) !== this.current.key) {
      // the line's text is gone or overwritten: the box closed
      this.current = null; result.changed = true; result.closed = true;
    }
    result.active = this.current;
    return result;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GenericReader;
  else root.KRGenericReader = GenericReader;
})(this);
