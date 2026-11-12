// Japanese text reader for Game Boy Advance Pokémon games built on the Emerald engine
// (Emerald, FireRed, LeafGreen). It follows the game's text printers: an array of
// struct TextPrinter in work RAM (pret/pokeemerald gflib/text.c, include/text.h):
//   +0x00 const u8 *currentChar   the next character to print
//   +0x04 u8 windowId, +0x05 u8 fontId
//   +0x10 callback (function pointer or 0)
//   +0x1B u8 active, +0x1C u8 state
// No addresses are hard-coded: the printers are found by this shape, and only text whose
// cursor moves (dialogue being typed) counts. Menus print instantly and never show up here.
(function (root) {
  'use strict';

  var EWRAM = 0x02000000, EWRAM_SIZE = 0x40000, IWRAM = 0x03000000, IWRAM_SIZE = 0x8000, ROM = 0x08000000;
  var EOS = 0xFF, NEWLINE = 0xFE, PLACEHOLDER = 0xFD, EXT_CTRL = 0xFC, PROMPT_CLEAR = 0xFB, PROMPT_SCROLL = 0xFA;
  var PRINTER_SIZE = 0x24, MAX_LEN = 1000;

  // Japanese character set (pokeemerald charmap.txt, Japanese section; 0xA1-0xF6 per the Japanese font).
  var HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんぁぃぅぇぉゃゅょがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽっ';
  var KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォャュョガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポッ';
  var REST = '0123456789！？。ー・‥『』「」♂♀円.×/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz▶：ÄÖÜäöü';
  var CHARS = ['　'].concat(HIRA.split(''), KATA.split(''), REST.split(''));   // 0x00 .. 0xF6
  // Length of an 0xFC command including its code byte (string_util.c GetExtCtrlCodeLength).
  var EXT_LEN = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];

  function Gen3Reader() {
    this.slots = new Map();      // printer address -> {start, key, cur0, moved, firstSeen}
    this.scanNo = 0;
    this.current = null;
    this.stats = { strings: 0, korean: 0, printers: 0 };
  }
  Gen3Reader.prototype.setLang = function () {};
  Gen3Reader.CHARS = CHARS;

  // mem: {rom, ew, iw} Uint8Arrays over the game file, work RAM and internal RAM.
  function byteAt(mem, a) {
    var r = a >>> 24, o = a & 0xFFFFFF;
    if (r === 8 || r === 9) { o = a - ROM; return o < mem.rom.length ? mem.rom[o] : -1; }
    if (r === 2) return mem.ew[o & (EWRAM_SIZE - 1)];
    if (r === 3) return mem.iw[o & (IWRAM_SIZE - 1)];
    return -1;
  }
  function validPtr(mem, p) {
    var r = p >>> 24;
    if (r === 8 || r === 9) return p - ROM < mem.rom.length;
    if (r === 2) return (p & 0xFFFFFF) < EWRAM_SIZE;
    if (r === 3) return (p & 0xFFFFFF) < IWRAM_SIZE;
    return false;
  }
  function u32(a, i) { return (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0; }

  // Start of the string the cursor is in: walk back to the end marker of whatever is before it.
  // Two spaces in a row (0x00 0x00) also end the walk: that is empty memory, not text.
  function findStart(mem, cur) {
    var a = cur;
    for (var n = 0; n < MAX_LEN; n++) {
      var b = byteAt(mem, a - 1);
      if (b < 0 || b === EOS) break;
      if (b === 0 && byteAt(mem, a - 2) === 0) break;
      a--;
    }
    while (byteAt(mem, a) === 0 && a < cur) a++;        // drop leading spaces
    return a;
  }

  // Decode from start to the end marker. Returns {text, pos, bytes, kana, other} or null if it isn't text.
  function decode(mem, start) {
    var out = [], pos = [], kana = 0, other = 0;
    for (var i = 0; i < MAX_LEN; i++) {
      var c = byteAt(mem, start + i);
      if (c < 0) return null;
      if (c === EOS) return { text: out.join(''), pos: pos, bytes: i, kana: kana, other: other };
      if (c === NEWLINE || c === PROMPT_SCROLL) { out.push('\n'); pos.push(i); continue; }
      if (c === PROMPT_CLEAR) { out.push('\n', '\n'); pos.push(i, i); continue; }
      if (c === EXT_CTRL) {
        var code = byteAt(mem, start + i + 1);
        if (code < 0 || code >= EXT_LEN.length) return null;   // not a real command: not text
        out.push('​'); pos.push(i);
        i += EXT_LEN[code];
        continue;
      }
      if (c === PLACEHOLDER) { out.push('·'); pos.push(i); i++; continue; }   // a name filled in later
      if (c >= 0xF7) { out.push('​'); pos.push(i); i++; continue; }      // icons and symbols: 1 argument
      if (c >= 0x01 && c <= 0xA0) kana++; else if (c > 0xA0) other++;
      out.push(CHARS[c]); pos.push(i);
    }
    return null;   // no end marker: not a string
  }

  // Does this look like dialogue in the game's language: some kana, and mostly kana?
  function looksJapanese(d) {
    return d && d.kana >= 2 && d.kana >= (d.kana + d.other) * 0.6;
  }

  Gen3Reader.prototype.scan = function (mem) {
    this.scanNo++;
    var ew = mem.ew, seen = new Map(), fresh = [], best = null, printers = 0, valid = 0, total = 0;
    for (var w = 0; w + PRINTER_SIZE <= EWRAM_SIZE; w += 4) {
      var p = u32(ew, w);
      if (!p || !validPtr(mem, p)) continue;
      // The rest of the struct must look like a text printer.
      if (ew[w + 4] >= 32 || ew[w + 5] >= 16 || ew[w + 0x1B] > 1 || ew[w + 0x1C] > 16) continue;
      var cb = u32(ew, w + 0x10);
      if (cb && !validPtr(mem, cb & ~1)) continue;
      var active = ew[w + 0x1B] === 1, prev = this.slots.get(w);
      if (!active && !prev) continue;            // only follow printers once they have printed something
      total++;
      // A finished printer has stepped past the end marker: step back onto the message it printed.
      // (An active printer that hasn't started yet sits right after the previous string's marker.)
      if (!active && byteAt(mem, p - 1) === EOS) p = p - 1;
      var start = findStart(mem, p), d = decode(mem, start);
      if (!looksJapanese(d)) continue;
      valid++;
      if (active) printers++;
      var cur = p - start, key = start + ':' + d.bytes + ':' + hash(d.text);
      var rec = prev && prev.key === key ? prev : { key: key, start: start, cur0: cur, moved: false, firstSeen: this.scanNo };
      if (cur !== rec.cur0) rec.moved = true;
      if (rec !== prev && this.scanNo > 1 && active) fresh.push(d.text);
      seen.set(w, rec);
      if (rec.moved && (!best || rec.firstSeen > best.rec.firstSeen)) best = { w: w, rec: rec, d: d, cur: cur };
    }
    this.slots = seen;
    this.stats = { strings: total, korean: valid, printers: printers };

    var result = { fresh: fresh, active: null, changed: false };
    if (best) {
      var shown = 0;
      while (shown < best.d.pos.length && best.d.pos[shown] < best.cur) shown++;
      var prevCur = this.current, same = prevCur && prevCur.key === best.rec.key;
      this.current = { addr: best.w, key: best.rec.key, text: best.d.text, shown: shown };
      result.changed = !same || prevCur.shown !== shown;
      result.newMessage = !same;
    }
    // A finished message stays up until the next one: Gen 3 keeps its text in the game file,
    // so there is no "string freed" moment like on the DS.
    result.active = this.current;
    return result;
  };

  function hash(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  Gen3Reader.decode = decode; Gen3Reader.findStart = findStart;
  if (typeof module !== 'undefined' && module.exports) module.exports = Gen3Reader;
  else root.KRGen3Reader = Gen3Reader;
})(this);
