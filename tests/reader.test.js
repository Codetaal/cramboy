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
u32[PRINTER] = 0x02000000 + data + 7 * 2;
// Decoy: pointer to start of the text (should be ignored)
u32[0x310000 >> 2] = 0x02000000 + data;
res = r.scan(u32, u16);
assert(res.active, 'should find active dialogue');
assert.strictEqual(res.newMessage, true);
console.log('shown text:', JSON.stringify(res.active.text.slice(0, res.active.shown)));
assert.strictEqual(res.active.text.slice(0, res.active.shown).replace(/​/g, ''), '안녕!');
assert(res.fresh.some(t => t.includes('공박사')));

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
u32[PRINTER] = 0x02400000 + data2 + 6 * 2;
res = r.scan(u32, u16);
assert.strictEqual(res.active.text.slice(0, res.active.shown), '야생 피카츄');
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
