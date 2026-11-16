// Builds docs/kr/ko-forms.json: conjugated verb forms our spelling rules (docs/kr/lookup.js) can't trace
// back to their verb, e.g. 들어 -> 듣다, 도와 -> 돕다, 몰라 -> 모르다, 그래 -> 그렇다.
// For every verb and adjective in the dictionary it writes out the common forms under every possible
// irregular conjugation, keeps the ones the ko-dic analyzer confirms belong to that verb, and stores the
// ones lookup.js gets wrong or misses. Run: node tools/build_ko_forms.js (needs lindera-wasm-ko-dic-nodejs).
const fs = require('fs');
const { TokenizerBuilder } = require('lindera-wasm-ko-dic-nodejs');
const L = require('../docs/kr/lookup.js');
const b = new TokenizerBuilder(); b.setDictionary('embedded://ko-dic'); const tk = b.build();
const dict = JSON.parse(fs.readFileSync(__dirname + '/../docs/kr/dict.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync(__dirname + '/../docs/kr/ko-pos.json', 'utf8'));
const verbs = new Set([].concat(pos.v.split('|'), pos.a.split('|')));

const S0 = 0xAC00;
const P = c => { const x = c.charCodeAt(0) - S0; return [Math.floor(x / 588), Math.floor(x % 588 / 28), x % 28]; };
const M = (a, b, c) => String.fromCharCode(S0 + a * 588 + b * 28 + (c || 0));
const isS = c => c && c.charCodeAt(0) >= S0 && c.charCodeAt(0) <= 0xD7A3;
// jong indices
const J = { none: 0, B: 17, D: 7, S: 19, H: 27, L: 8, SS: 20, N: 4 };
const bright = v => v === 0 || v === 8 || v === 9;   // ㅏ ㅗ ㅘ: 아; otherwise 어

// The -아/어 form of a stem under each conjugation type it could have.
// kind: 'reg' = the stem written out plainly (먹어), 'irr' = changed (추워, 써, 가). The analyzer also accepts
// some made-up plain forms of irregular verbs (춥어, 쓰었), so a verb with a confirmed changed form drops
// its plain vowel-initial forms.
function aForms(stem) {
  const out = new Map(), head = stem.slice(0, -1), last = stem.slice(-1);
  out.addK = (k, kind) => out.set(k, out.get(k) === 'irr' ? 'irr' : kind);
  if (!isS(last)) return out;
  const [c, v, j] = P(last), A = bright(v) ? '아' : '어';
  if (last === '하') { out.addK(head + '해', 'irr'); return out; }
  if (j) {
    out.addK(stem + A, 'reg');                               // 먹어, 잡아
    if (j === J.B) { out.addK(head + M(c, v) + '워', 'irr'); out.addK(head + M(c, v) + '와', 'irr'); }   // 춥 -> 추워, 돕 -> 도와
    if (j === J.D) out.addK(head + M(c, v, J.L) + A, 'irr'); // 듣 -> 들어
    if (j === J.S) out.addK(head + M(c, v) + A, 'irr');      // 낫 -> 나아
    if (j === J.H) { out.addK(head + M(c, v === 0 || v === 4 ? 1 : v === 2 ? 3 : v, 0), 'irr'); out.addK(head + M(c, 1), 'irr'); }   // 그렇 -> 그래, 하얗 -> 하얘
    return out;
  }
  // no final consonant
  if ([0, 1, 4, 5, 6].includes(v)) out.addK(stem, 'irr');     // 가, 서, 내, 켜
  if (v === 8) out.addK(head + M(c, 9), 'irr');               // 보 -> 봐
  if (v === 13) out.addK(head + M(c, 14), 'irr');             // 주 -> 줘
  if (v === 20) out.addK(head + M(c, 6), 'irr');              // 마시 -> 마셔
  if (v === 11) out.addK(head + M(c, 10), 'irr');             // 되 -> 돼
  if (v === 18) {                                             // ㅡ drops: 쓰 -> 써, 아프 -> 아파; 르 -> 몰라
    const pv = head ? P(head.slice(-1))[1] : 4;
    out.addK(head + M(c, bright(pv) ? 0 : 4), 'irr');
    if (last === '르' && head) { const [hc, hv] = P(head.slice(-1)); out.addK(head.slice(0, -1) + M(hc, hv, J.L) + (bright(hv) ? '라' : '러'), 'irr'); }
  }
  out.addK(stem + (bright(v) ? '아' : '어'), 'reg');
  return out;
}
// Past tense syllable: the -아/어 form's last syllable with ㅆ (갔, 먹었, 몰랐).
const past = a => { const l = a.slice(-1), [c, v, j] = P(l); return j ? null : a.slice(0, -1) + M(c, v, J.SS); };
const VOWEL_START = /^[아어았었으읍]/;
// -(으) forms: 먹으, 도우, 들으, 나으, 그러 / and the ㄹ-dropped stem (아, 만드).
function euForms(stem) {
  const out = new Map(), head = stem.slice(0, -1), last = stem.slice(-1);
  if (!isS(last)) return out;
  const [c, v, j] = P(last);
  if (!j) { out.set(stem, 'reg'); return out; }
  if (j !== J.L) out.set(stem + '으', 'reg');                 // ㄹ stems never take 으 (알면, not 알으면)
  if (j === J.B) out.set(head + M(c, v) + '우', 'irr');
  if (j === J.D) out.set(head + M(c, v, J.L) + '으', 'irr');
  if (j === J.S) out.set(head + M(c, v) + '으', 'irr');
  if (j === J.H) out.set(head + M(c, v), 'irr');
  if (j === J.L) out.set(head + M(c, v), 'irr');
  return out;
}
const withJong = (s, jong) => { const l = s.slice(-1); if (!isS(l)) return null; const [c, v, j] = P(l); return j ? null : s.slice(0, -1) + M(c, v, jong); };

function surfaces(stem) {
  const out = new Map(), add = (k, kind) => out.set(k, out.get(k) === 'irr' ? 'irr' : kind);
  aForms(stem).forEach((kind, a) => { add(a, kind); ['서', '요', '도', '야', '라'].forEach(e => add(a + e, kind)); const p = past(a); if (p) { add(p, kind); add(p + '다', kind); add(p + '어', kind); add(p + '어요', kind); } });
  euForms(stem).forEach((kind, e) => {
    ['면', '니까', '세요', '려고', '러'].forEach(x => add(e + x, kind));
    const n = withJong(e, J.N), l = withJong(e, J.L), b = withJong(e, J.B);
    if (n) add(n, kind); if (l) add(l, kind); if (b) add(b + '니다', kind);
  });
  ['는', '고', '지', '게', '기', '네'].forEach(x => add(stem + x, 'base'));
  const last = stem.slice(-1); if (isS(last) && P(last)[2] === J.L) ['는', '네', '니'].forEach(x => add(stem.slice(0, -1) + M(P(last)[0], P(last)[1]) + x, 'irr'));
  return out;
}
// Does the analyzer read this surface as a form of stem?
function confirms(surface, stem) {
  const toks = tk.tokenize(surface);
  if (!toks.length || toks[0].isUnknown) return false;
  const d = toks[0].details, first = (d[7] && d[7] !== '*' ? d[7].split('+')[0].split('/')[0] : toks[0].surface);
  const tag = (d[7] && d[7] !== '*' ? d[7].split('+')[0].split('/')[1] : d[0].split('+')[0]);
  return first === stem && /^(VV|VA|VX)$/.test(tag);
}
const out = {}; let tried = 0, ok = 0;
for (const v of verbs) {
  if (!/다$/.test(v) || /하다$/.test(v)) continue;          // 하다 verbs are handled by the rules
  const stem = v.slice(0, -1), all = surfaces(stem), good = [];
  for (const [s, kind] of all) { tried++; if (!dict[s] && confirms(s, stem)) good.push([s, kind]); }
  const irregular = good.some(([, kind]) => kind === 'irr');
  for (const [s, kind] of good) {
    if (irregular && kind === 'reg' && VOWEL_START.test(s.slice(stem.length))) continue;   // made-up plain form (춥어)
    if (out[s]) continue;
    ok++;
    const hits = L.lookup(dict, s, 3);
    if (hits[0] && hits[0].word === v) continue;             // the rules already get it right
    out[s] = v;
  }
}
// Store compactly: { verb: "form|form" }
const byVerb = {}; for (const s in out) (byVerb[out[s]] = byVerb[out[s]] || []).push(s);
const res = {}; for (const v in byVerb) res[v] = byVerb[v].join('|');
fs.writeFileSync(__dirname + '/../docs/kr/ko-forms.json', JSON.stringify(res));
console.log('surfaces tried', tried, 'confirmed', ok, 'stored', Object.keys(out).length, 'verbs', Object.keys(res).length);
