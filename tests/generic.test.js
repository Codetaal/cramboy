// General reader (non-Pokémon games): synthetic 4 MB RAM with text in UTF-16, Shift-JIS and EUC-KR and a
// "printer" pointer that moves through it.
const assert = require('assert');
const G = require(__dirname + '/../docs/kr/generic.js');

function ram() { const buf = new ArrayBuffer(4 << 20); return { buf, u8: new Uint8Array(buf), u16: new Uint16Array(buf), u32: new Uint32Array(buf) }; }
function putU16(m, addr, str) { for (let i = 0; i < str.length; i++) m.u16[(addr >> 1) + i] = str.charCodeAt(i); m.u16[(addr >> 1) + str.length] = 0; }
function putBytes(m, addr, bytes) { m.u8.set(bytes, addr); m.u8[addr + bytes.length] = 0; }
const ptr = (m, at, addr) => { m.u32[at >> 2] = 0x02000000 + addr; };
const shown = r => r.active && r.active.text.slice(0, r.active.shown);

// --- UTF-16 Korean, typed out: the pointer moves, so it is dialogue ---
{
  const m = ram(), g = new G('ko'), line = '안녕! 오늘은 날씨가\n정말 좋구나.';
  putU16(m, 0x100000, line);
  putU16(m, 0x110000, '가나다라마바사아자차카');            // a table: counts upwards, no spaces
  ptr(m, 0x110040, 0x110000 + 8);
  ptr(m, 0x200000, 0x100000 + 2 * 3);                      // printer at "안녕!"
  let r = g.scan(m.u32, m.u16);
  assert.strictEqual(r.active, null, 'not yet: the pointer has not moved');
  ptr(m, 0x200000, 0x100000 + 2 * 7);
  r = g.scan(m.u32, m.u16);
  assert.strictEqual(shown(r), '안녕! 오늘은', 'moving pointer');
  assert.strictEqual(r.active.text, line);
  assert.ok(r.newMessage && r.changed);
  ptr(m, 0x200000, 0x100000 + 2 * line.length);           // finished
  r = g.scan(m.u32, m.u16);
  assert.strictEqual(shown(r), line);
  assert.ok(!r.newMessage && r.changed);
  m.u32[0x200000 >> 2] = 0;                                // printer done and gone: the line stays
  r = g.scan(m.u32, m.u16);
  assert.strictEqual(shown(r), line, 'held after the printer goes');
  m.u16.fill(0, 0x100000 >> 1, (0x100000 >> 1) + 40);      // text freed: box closed
  r = g.scan(m.u32, m.u16);
  assert.ok(r.closed && r.active === null, 'closed');
}

// --- a line already complete when the reader starts (pointer at its end) ---
{
  const m = ram(), g = new G('ko'), line = '여기는 어디지?';
  putU16(m, 0x120000, line);
  ptr(m, 0x200100, 0x120000 + 2 * line.length);
  assert.strictEqual(shown(g.scan(m.u32, m.u16)), line, 'pointer at end');
}

// --- game control codes between characters (colour, new line in the game's own code) ---
{
  const m = ram(), g = new G('ko');
  putU16(m, 0x130000, '빨간 \u0002모자 를 찾아 줘');
  ptr(m, 0x200200, 0x130000 + 2 * 15);
  const r = g.scan(m.u32, m.u16);
  assert.strictEqual(r.active.text, '빨간 모자 를 찾아 줘', 'codes skipped');
}

// --- Shift-JIS Japanese ---
{
  const m = ram(), g = new G('ja');
  // 「こんにちは、せかい」 in Shift-JIS
  const sj = [0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD, 0x81, 0x41, 0x82, 0xB9, 0x82, 0xA9, 0x82, 0xA2];
  putBytes(m, 0x140001, sj);                               // byte strings need no alignment
  ptr(m, 0x200300, 0x140001 + 4);
  g.scan(m.u32, m.u16);
  ptr(m, 0x200300, 0x140001 + 10);
  const r = g.scan(m.u32, m.u16);
  assert.strictEqual(r.active.text, 'こんにちは、せかい');
  assert.strictEqual(shown(r), 'こんにちは');
}

// --- EUC-KR Korean ---
{
  const m = ram(), g = new G('ko');
  // "안녕 친구" in EUC-KR
  const euc = [0xBE, 0xC8, 0xB3, 0xE7, 0x20, 0xC4, 0xA3, 0xB1, 0xB8];
  putBytes(m, 0x150000, euc);
  ptr(m, 0x200400, 0x150000 + euc.length);
  const r = g.scan(m.u32, m.u16);
  assert.strictEqual(r.active.text, '안녕 친구');
  assert.strictEqual(shown(r), '안녕 친구');
}

// --- newest line wins ---
{
  const m = ram(), g = new G('ko');
  putU16(m, 0x160000, '첫 번째 대사야.');
  ptr(m, 0x200500, 0x160000 + 2 * 9);
  assert.strictEqual(g.scan(m.u32, m.u16).active.text, '첫 번째 대사야.');
  putU16(m, 0x170000, '이건 두 번째 대사.');
  ptr(m, 0x200600, 0x170000 + 2 * 10);
  const r = g.scan(m.u32, m.u16);
  assert.strictEqual(r.active.text, '이건 두 번째 대사.');
  assert.ok(r.newMessage);
}

// --- noise: rare syllables and odd pointers are not text ---
{
  const m = ram(), g = new G('ko');
  putU16(m, 0x180000, '뀄뷸딸 훺뙽');
  ptr(m, 0x200700, 0x180000 + 2 * 6);
  putU16(m, 0x190000, '이건 진짜 문장');
  ptr(m, 0x200800, 0x190000 + 3);                          // odd address: not a character
  assert.strictEqual(g.scan(m.u32, m.u16).active, null);
}

// --- reader.js uses it when there are no Pokémon strings ---
{
  global.window = {}; require(__dirname + '/../docs/kr/table.js');
  const Reader = require(__dirname + '/../docs/kr/reader.js');
  const m = ram(), r = new Reader(global.window.KR_TABLE), line = '모험을 떠나자!';
  putU16(m, 0x1A0000, line);
  ptr(m, 0x200900, 0x1A0000 + 2 * line.length);
  let res;
  for (let k = 0; k < 6; k++) res = r.scan(m.u32, m.u16);
  assert.strictEqual(res.active && res.active.text, line, 'fallback');
  assert.ok(r.stats.generic);
}
console.log('generic ok');
