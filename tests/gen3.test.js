// Gen 3 (Emerald engine) Japanese reader on simulated memory.
const R = require('../docs/kr/gen3.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const C = R.CHARS, inv = {}; C.forEach((ch, i) => { inv[ch] = i; });
assert(C.length === 0xF7, 'table has 0xF7 entries, got ' + C.length.toString(16));
assert(C[0x01] === 'あ' && C[0x50] === 'っ' && C[0x51] === 'ア' && C[0xA0] === 'ッ' && C[0xA1] === '0', 'kana/digit positions');
assert(C[0xAD] === '。' && C[0xB3] === '「' && C[0xB4] === '」' && C[0xBB] === 'A' && C[0xEF] === '▶' && C[0xF6] === 'ü', 'punctuation/latin positions');
function enc(s) { const out = []; for (const ch of s) { if (ch === '\n') out.push(0xFE); else if (ch === '|') out.push(0xFB); else { assert(ch in inv, 'char ' + ch); out.push(inv[ch]); } } out.push(0xFF); return out; }

const rom = new Uint8Array(0x10000), ew = new Uint8Array(0x40000), iw = new Uint8Array(0x8000);
const mem = { rom, ew, iw };
// ROM: strings packed back to back, as in the game.
const msgs = ['はい', 'ポケモンの　せかいへ\nようこそ！|わたしは　オダマキ', 'つぎの　メッセージ'];
let o = 0x1000; const at = [];
msgs.forEach(m => { at.push(o); const b = enc(m); rom.set(b, o); o += b.length; });
// A colour command in the middle: FC 01 02 must be skipped.
const colored = [...enc('あか').slice(0, 2), 0xFC, 0x01, 0x02, ...enc('いろ')]; rom.set(colored, 0x3000);
// Script bytecode (not text) for a decoy pointer.
for (let i = 0; i < 64; i++) rom[0x5000 + i] = (i * 37 + 0xC1) & 0xFF;
const W32 = (a, off, v) => { a[off] = v & 255; a[off + 1] = (v >>> 8) & 255; a[off + 2] = (v >>> 16) & 255; a[off + 3] = v >>> 24; };
const BASE = 0x2400;   // printer array
function printer(i, ptr, active) { const s = BASE + i * 0x24; W32(ew, s, ptr); ew[s + 4] = i; ew[s + 5] = 1; W32(ew, s + 0x10, 0x08001235); ew[s + 0x1B] = active ? 1 : 0; ew[s + 0x1C] = 1; }
// Decoy: a script context pointer moving through bytecode, with a struct that does not look like a printer.
function decoy(ptr) { W32(ew, 0x9000, ptr); ew[0x9004] = 200; }

const r = new R();
const P = 0x08000000;
// 1) Printer 0 starts typing message 2 (cursor at its start).
printer(0, P + at[1], true); decoy(P + 0x5000);
let res = r.scan(mem);
assert(!res.active, 'nothing shown before the cursor moves');
// 2) It types 5 characters; decoy moves too.
printer(0, P + at[1] + 5, true); decoy(P + 0x5008);
res = r.scan(mem);
assert(res.active && res.active.text.startsWith('ポケモンの　せかいへ\nようこそ！'), 'message decoded: ' + JSON.stringify(res.active && res.active.text));
assert(res.active.text.slice(0, res.active.shown) === 'ポケモンの', 'shown so far: ' + res.active.text.slice(0, res.active.shown));
assert(res.active.text.includes('ようこそ！\n\nわたしは'), 'page break becomes a blank line');
// 3) Finished: printer inactive, cursor one past the end marker (pointing at message 3).
printer(0, P + at[2], false);
res = r.scan(mem);
assert(res.active && res.active.shown === res.active.text.length && res.active.text.endsWith('オダマキ'), 'finished message stays fully shown');
// 4) A new message in another window: picked as the newest.
printer(3, P + 0x3000, true); r.scan(mem); printer(3, P + 0x3004, true);
res = r.scan(mem);
assert(res.active && res.active.text.replace(/​/g, '') === 'あかいろ' && res.newMessage, 'colour command skipped, new message: ' + JSON.stringify(res.active && res.active.text));
assert(r.stats.korean >= 1, 'stats');
// 5) Text in work RAM (expanded names), preceded by zeros.
const buf = 0x10000, b = enc('ハルカ　の　ばん！'); ew.set(b, buf);
printer(5, 0x02000000 + buf, true); r.scan(mem); printer(5, 0x02000000 + buf + 3, true);
res = r.scan(mem);
assert(res.active && res.active.text === 'ハルカ　の　ばん！' && res.active.shown === 3, 'RAM text: ' + JSON.stringify(res.active));
console.log('GEN3 TEST PASSED');
