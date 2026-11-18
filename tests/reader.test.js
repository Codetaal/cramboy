const assert = require('assert');
global.window = {}; require(__dirname + '/../docs/kr/table.js'); const T = global.window.KR_TABLE;
const Reader = require(__dirname + '/../docs/kr/reader.js');
const enc = {}; for (let i = 0; i < T.length; i++) if (T[i] !== '\0' && !(T[i] in enc)) enc[T[i]] = i;
enc[' '] = 0x1DE;
const buf = new ArrayBuffer(4 << 20), u32 = new Uint32Array(buf), u16 = new Uint16Array(buf);
function encode(s) { const out = []; for (const ch of s) { if (ch === '\n') out.push(0xE000); else if (ch === '\f') out.push(0x25BD); else { assert(ch in enc, 'no code for ' + ch); out.push(enc[ch]); } } return out; }
function putString(byteAddr, codes, maxsize) {
  u32[byteAddr >> 2] = (maxsize || codes.length + 8) | (codes.length << 16);
  u32[(byteAddr >> 2) + 1] = Reader.STRING_MAGIC;
  codes.forEach((c, i) => u16[(byteAddr + 8 >> 1) + i] = c); u16[(byteAddr + 8 >> 1) + codes.length] = 0xFFFF;
  return byteAddr + 8; // data start
}
// Static menu strings (present at first scan) and an English string
putString(0x100000, encode('가방'));
putString(0x100100, encode('Hello'));
const r = new Reader(T);
let res = r.scan(u32, u16);
assert.strictEqual(res.active, null);
assert.strictEqual(r.stats.korean, 1);

// Dialogue appears: a control code (colour) + two pages
const msg = [0xFFFE, 0xFF00, 1, 0x0002].concat(encode('안녕! 포켓몬의 세계에\n잘 왔단다!\f나는 공박사란다.'));
const data = putString(0x200000, msg);
// Heap text printer: cursor pointer after 5 codes (ctrl + '안녕!' = 4+3 = 7 codes) 
const PRINTER = 0x300000 >> 2;
u32[PRINTER] = 0x02000000 + data + 6 * 2;
// Decoy: pointer to start of the text (should be ignored)
u32[0x310000 >> 2] = 0x02000000 + data;
res = r.scan(u32, u16);
assert.strictEqual(res.active, null, 'not dialogue until its cursor moves');
assert(res.fresh.some(t => t.includes('공박사')), 'new text is still collected for the Recent list');
u32[PRINTER] = 0x02000000 + data + 7 * 2;   // the printer types the next letter
res = r.scan(u32, u16);
assert(res.active, 'should find active dialogue');
assert.strictEqual(res.newMessage, true);
console.log('shown text:', JSON.stringify(res.active.text.slice(0, res.active.shown)));
assert.strictEqual(res.active.text.slice(0, res.active.shown).replace(/​/g, ''), '안녕!');

// Printer advances to the end
u32[PRINTER] = 0x02000000 + data + msg.length * 2;
res = r.scan(u32, u16);
assert.strictEqual(res.newMessage, false);
assert.strictEqual(res.active.shown, res.active.text.length);
console.log('full text:', JSON.stringify(res.active.text.replace(/​/g, '')));

// String freed: magic invalidated -> dialogue closes
u32[(0x200000 >> 2) + 1] = 0xB6F8D2ED;
res = r.scan(u32, u16);
assert.strictEqual(res.active, null); assert(res.closed);

// Mirror addresses (0x02400000 + x) also work
const data2 = putString(0x220000, encode('야생 피카츄가 나타났다!'));
u32[PRINTER] = 0x02400000 + data2 + 5 * 2;
r.scan(u32, u16);
u32[PRINTER] = 0x02400000 + data2 + 6 * 2;
res = r.scan(u32, u16);
assert.strictEqual(res.active.text.slice(0, res.active.shown), '야생 피카츄');
// Gen 4 text printers (cursor word followed by a Window pointer): a top-screen printer waiting on a page
// counts straight away (resuming mid-dialogue); a touch-screen one (the A button's "조사한다") never does.
{
  const r2 = new Reader(T);
  const zero = () => { u32.fill(0); };
  zero();
  const win = (addr, bg) => { u32[addr >> 2] = 0x02010000; u32[(addr >> 2) + 1] = bg | (2 << 8) | (19 << 16) | (27 << 24); u32[(addr >> 2) + 2] = 4; return 0x02000000 + addr; };
  const d1 = putString(0x240000, encode('TV가 있다...'.replace('TV', '티비')));
  const top = win(0x250000, 3);
  u32[0x260000 >> 2] = 0x02000000 + d1 + 3 * 2; u32[(0x260000 >> 2) + 1] = top;
  let r1 = r2.scan(u32, u16); r1 = r2.scan(u32, u16);
  assert(r1.active && r1.active.shown === 3, 'top-screen printer waiting on a page is dialogue');
  zero();
  const r3 = new Reader(T);
  const d2 = putString(0x240000, encode('조사한다'));
  const sub = win(0x250000, 5);
  u32[0x260000 >> 2] = 0x02000000 + d2 + 1 * 2; u32[(0x260000 >> 2) + 1] = sub;
  r3.scan(u32, u16); const r4 = r3.scan(u32, u16);
  assert.strictEqual(r4.active, null, 'touch-screen label printer is not dialogue');
  zero();
}
// A printer that finished the message points one past the last character (at the end mark): the last
// character ("!") still counts as shown.
{
  u32.fill(0);
  const r7 = new Reader(T);
  const codes = encode('빨리 가야지!'), d = putString(0x240000, codes);
  const win = 0x250000; u32[win >> 2] = 0x02010000; u32[(win >> 2) + 1] = 3 | (2 << 8) | (19 << 16) | (27 << 24); u32[(win >> 2) + 2] = 4;
  u32[0x260000 >> 2] = 0x02000000 + d + (codes.length + 1) * 2; u32[(0x260000 >> 2) + 1] = 0x02000000 + win;
  r7.scan(u32, u16); const f = r7.scan(u32, u16);
  assert(f.active && f.active.shown === f.active.text.length && f.active.text.endsWith('!'), 'finished printer: last character shown');
  u32.fill(0);
}
// The town-name banner (a printer in a window at the very top of the top screen) is not dialogue, and
// once dialogue printers have been seen, a touch-screen label with a moving pointer isn't either.
{
  u32.fill(0);
  const r8 = new Reader(T);
  const mk = (addr, bg, top) => { u32[addr >> 2] = 0x02010000; u32[(addr >> 2) + 1] = bg | (0 << 8) | (top << 16) | (32 << 24); u32[(addr >> 2) + 2] = 5; return 0x02000000 + addr; };
  const town = putString(0x240000, encode('연두마을'));
  u32[0x260000 >> 2] = 0x02000000 + town + 2 * 2; u32[(0x260000 >> 2) + 1] = mk(0x250000, 3, 0);
  r8.scan(u32, u16); u32[0x260000 >> 2] = 0x02000000 + town + 4 * 2; const t1 = r8.scan(u32, u16);
  assert.strictEqual(t1.active, null, 'town-name banner is not dialogue');
  u32.fill(0);
  const r9 = new Reader(T);
  const msg = putString(0x240000, encode('안녕 친구'));
  u32[0x260000 >> 2] = 0x02000000 + msg + 3 * 2; u32[(0x260000 >> 2) + 1] = mk(0x250000, 3, 19);
  r9.scan(u32, u16); const m1 = r9.scan(u32, u16);
  assert(m1.active, 'dialogue printer seen');
  u32.fill(0);
  const label = putString(0x244000, encode('포켓기어'));
  u32[0x270000 >> 2] = 0x02000000 + label + 1 * 2; r9.scan(u32, u16);
  u32[0x270000 >> 2] = 0x02000000 + label + 3 * 2; const l1 = r9.scan(u32, u16);
  assert(!l1.active || l1.active.text !== '포켓기어', 'moving label pointer is not dialogue');
  u32.fill(0);
}
// Resuming on a message typed to the end: no printer, but the open message box (a top-screen Window with
// a pointer to the String 0x34 bytes after it) shows it. Once the Window is gone (box closed), nothing.
{
  u32.fill(0);
  const r5 = new Reader(T);
  const d = putString(0x240000, encode('자 공박사님이 기다리고 계셔'));
  const box = 0x250000;
  u32[box >> 2] = 0x02010000; u32[(box >> 2) + 1] = 3 | (2 << 8) | (19 << 16) | (27 << 24); u32[(box >> 2) + 2] = 4; u32[(box >> 2) + 3] = 0x02300000;
  u32[(box + 0x34) >> 2] = 0x02000000 + d - 8;   // pointer to the String object
  const a = r5.scan(u32, u16);
  assert(a.active && a.active.shown === a.active.text.length, 'message in an open box is shown in full after resuming');
  u32[box >> 2] = 0;                              // box closed: Window removed
  const r6 = new Reader(T); const b2 = r6.scan(u32, u16);
  assert.strictEqual(b2.active, null, 'no box, no subtitle');
  u32.fill(0);
}
// Timing for one scan
const t0 = process.hrtime.bigint(); for (let k = 0; k < 20; k++) r.scan(u32, u16); 
console.log('scan ms:', Number(process.hrtime.bigint() - t0) / 20 / 1e6);
console.log('ALL READER TESTS PASSED');

// ---- Gen 5 (Pokémon Black/White): Unicode text, 0xFFFE new line, 0xF000 commands ----
{
  const buf5 = new ArrayBuffer(4 << 20), a32 = new Uint32Array(buf5), a16 = new Uint16Array(buf5);
  const r5 = new Reader(T);
  r5.scan(a32, a16);
  const uni = s => [...s].map(c => c.charCodeAt(0));
  const PAGE = [0xF000, 0xBE01, 0x0000], NL = [0xFFFE];
  const codes = uni('안녕!').concat(PAGE, NL, uni('하나지방에'), NL, uni('어서 와!'), PAGE);
  const addr = 0x250000;
  a32[addr >> 2] = 1600 | (codes.length << 16);           // White uses a 1600-char buffer
  a32[(addr >> 2) + 1] = Reader.STRING_MAGIC;
  codes.forEach((c, i) => a16[(addr + 8 >> 1) + i] = c); a16[(addr + 8 >> 1) + codes.length] = 0xFFFF;
  a32[0x260000 >> 2] = 0x02000000 + addr + 8 + codes.length * 2;   // printer finished
  const res5 = r5.scan(a32, a16);
  assert(res5.active, 'Gen 5 dialogue found');
  const page5 = res5.active.text.slice(0, res5.active.shown).replace(/\n+$/, '').split('\n\n').pop().replace(/^\n+/, '');
  assert.strictEqual(page5, '하나지방에\n어서 와!');
  console.log('Gen 5 subtitle:', JSON.stringify(page5));
  console.log('GEN 5 TESTS PASSED');
}

// ---- Gen 5: two copies of a message; the old dialogue's address now holds the lagging copy ----
{
  const buf = new ArrayBuffer(4 << 20), a32 = new Uint32Array(buf), a16 = new Uint16Array(buf);
  const r = new Reader(T), uni = s => [...s].map(c => c.charCodeAt(0));
  const put = (addr, codes, cursor, ptrAt) => {
    a32[addr >> 2] = 1600 | (codes.length << 16); a32[(addr >> 2) + 1] = Reader.STRING_MAGIC;
    codes.forEach((c, i) => a16[(addr + 8 >> 1) + i] = c); a16[(addr + 8 >> 1) + codes.length] = 0xFFFF;
    a32[ptrAt >> 2] = 0x02000000 + addr + 8 + cursor * 2;
  };
  r.scan(a32, a16);
  // message 1: printed copy at B (cursor at end), raw copy at A (page-start pointer)
  const m1 = uni('하-이!');
  put(0x2D0000, m1, 1, 0x300000); put(0x2D1000, m1, m1.length, 0x300100);
  let res = r.scan(a32, a16);
  assert.strictEqual(res.active.addr, 0x2D1000);
  // message 2: roles swapped in memory; lagging pointer now in the copy at B's address
  const m2 = uni('그래! 이 세계에는').concat([0xFFFE], uni('포켓몬스터'));
  put(0x2D1000, m2, 5, 0x300100); put(0x2D0000, m2, m2.length, 0x300000);
  res = r.scan(a32, a16);
  const shown = res.active.text.slice(0, res.active.shown);
  assert.strictEqual(shown, '그래! 이 세계에는\n포켓몬스터', 'follows the copy printed furthest');
  console.log('Gen 5 two-copy test:', JSON.stringify(shown));
  console.log('GEN 5 COPY TESTS PASSED');
}

// ---- Japanese (lang 'ja'): Gen 4 kana from the game's table, Gen 5 Unicode kana/kanji ----
{
  u32.fill(0);
  const rj = new Reader(T, 'ja');
  const encJ = s => [...s].map(ch => ch === '\n' ? 0xE000 : ch === ' ' ? 0x0001 : (assert(ch in enc, 'no JP code for ' + ch), enc[ch]));
  putString(0x100000, encode('가방'));                         // Korean string: ignored in Japanese mode
  let rr = rj.scan(u32, u16);
  assert.strictEqual(rj.stats.korean, 0, 'Korean text must not count in Japanese mode');
  // Gen 4 HeartGold (Japanese): kana only, spaces between words
  const msgJ = encJ('ポケモンの せかいへ\nようこそ！');
  const dJ = putString(0x200000, msgJ);
  u32[0x300000 >> 2] = 0x02000000 + dJ + 4 * 2; rj.scan(u32, u16);
  u32[0x300000 >> 2] = 0x02000000 + dJ + 5 * 2;
  rr = rj.scan(u32, u16);
  assert(rr.active, 'Japanese G4 dialogue found');
  assert.strictEqual(rr.active.text.slice(0, rr.active.shown), 'ポケモンの');
  console.log('JA G4 text:', JSON.stringify(rr.active.text));
  // Gen 5 White (Japanese, kanji mode): Unicode with 0xFFFE new line
  u32.fill(0);
  const rj5 = new Reader(T, 'ja');
  rj5.scan(u32, u16);
  const uni = s => [...s].map(c => c === '\n' ? 0xFFFE : c.charCodeAt(0));
  const m5 = uni('ポケモンの　世界へ\nようこそ！');
  const d5 = putString(0x240000, m5);
  u32[0x300000 >> 2] = 0x02000000 + d5 + 5 * 2; rj5.scan(u32, u16);
  u32[0x300000 >> 2] = 0x02000000 + d5 + 6 * 2;
  rr = rj5.scan(u32, u16);
  assert(rr.active, 'Japanese G5 dialogue found');
  assert.strictEqual(rr.active.text.slice(0, rr.active.shown), 'ポケモンの　');
  console.log('JA G5 text:', JSON.stringify(rr.active.text));
  // Korean reader ignores Japanese text
  const rk = new Reader(T, 'ko'); rk.scan(u32, u16);
  assert.strictEqual(rk.stats.korean, 0);
  console.log('JAPANESE READER TESTS PASSED');
}

// ---- A touch-screen label with a pointer that never moves (HeartGold's "조사한다" button) ----
{
  u32.fill(0);
  const rl = new Reader(T);
  rl.scan(u32, u16);
  const dlg = encode('TV가 있다…');
  const dd = putString(0x200000, dlg);
  u32[0x300000 >> 2] = 0x02000000 + dd + 3 * 2; rl.scan(u32, u16);
  u32[0x300000 >> 2] = 0x02000000 + dd + dlg.length * 2;   // dialogue printed to the end
  let rr = rl.scan(u32, u16);
  assert.strictEqual(rr.active.text, 'TV가 있다…');
  // A newer string appears: the button label, with a pointer stuck after its first letter
  const lab = putString(0x220000, encode('조사한다'));
  u32[0x310000 >> 2] = 0x02000000 + lab + 1 * 2;
  for (let k = 0; k < 3; k++) rr = rl.scan(u32, u16);
  assert.strictEqual(rr.active.text, 'TV가 있다…', 'a label with a fixed pointer is not dialogue');
  console.log('LABEL TEST PASSED');
}
