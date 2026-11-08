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
