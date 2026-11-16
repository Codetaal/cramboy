// Tags every word in docs/kr/dict.json with its word type using the ko-dic morphological analyzer
// (lindera, run here once, not in the app). Writes docs/kr/ko-pos.json: { type: "word|word|..." }.
// Nouns (most words) are left out: a word missing from the file is a noun.
// x: an entry that is a word + particle / ending (마지막으로 = finally): an expression.
// Types: n noun, v verb, a adjective (descriptive verb), d adverb, p pronoun, u number, m determiner, i interjection.
// Run: node tools/tag_ko_pos.js   (needs: npm i -D lindera-wasm-ko-dic-nodejs)
const fs = require('fs');
const { TokenizerBuilder } = require('lindera-wasm-ko-dic-nodejs');
const b = new TokenizerBuilder(); b.setDictionary('embedded://ko-dic'); const tk = b.build();
const dict = JSON.parse(fs.readFileSync(__dirname + '/../docs/kr/dict.json', 'utf8'));

const NOUN = /^(NNG|NNP|NNB|XR)$/;
function tagOf(word) {
  const toks = tk.tokenize(word).filter(t => !/^S/.test(t.details[0]));
  if (!toks.length || toks.some(t => t.isUnknown)) return '';
  const tags = toks.map(t => t.details[0]);
  const first = tags[0].split('+')[0];
  if (/다$/.test(word)) {
    // 알다 = 알/VV + 다/EF; 공부하다 = 공부/NNG + 하/XSV + 다; 깨끗하다 = 깨끗/XR + 하/XSA + 다
    const all = tags.join(' ');
    if (/\bXSA\b|\bVA\b/.test(all) && !/\bVV\b|\bXSV\b/.test(all)) return 'a';
    if (/\bVV\b|\bXSV\b|\bVX\b/.test(all)) return 'v';
    if (/\bVCP\b/.test(all)) return '';            // 이다
  }
  // A dictionary entry that is a word + particle or ending (나는 = 나 + 는, 마지막으로 = 마지막 + 으로): 'x',
  // shown as an expression (its own meaning, like "finally", is kept).
  if (!/다$/.test(word) && toks.length > 1 && /^(J|E)/.test(tags[tags.length - 1]) && !/\((Pokémon|move|item|place|ability|type|nature)\)/.test(dict[word])) {
    const head = toks.slice(0, -1).map(t => t.surface).join('');
    if (dict[head]) return 'x';
  }
  if (toks.length === 1 || tags.every(t => NOUN.test(t.split('+')[0]))) {
    if (NOUN.test(first)) return 'n';
    if (/^(MAG|MAJ)$/.test(first)) return 'd';
    if (first === 'NP') return 'p';
    if (first === 'NR') return 'u';
    if (first === 'MM') return 'm';
    if (first === 'IC') return 'i';
    if (first === 'VV') return 'v';
    if (first === 'VA') return 'a';
  }
  return '';
}
// ko-dic calls 있다 / 없다 descriptive (adjective-like); for learners they read as verbs ("there is", "there isn't").
const OVERRIDE = { '있다': 'v', '없다': 'v', '계시다': 'v' };
const out = {}; let n = 0;
for (const w of Object.keys(dict)) {
  const t = OVERRIDE[w] || tagOf(w); if (!t || t === 'n') continue;
  (out[t] = out[t] || []).push(w); n++;
}
const res = {}; for (const t in out) res[t] = out[t].join('|');
fs.writeFileSync(__dirname + '/../docs/kr/ko-pos.json', JSON.stringify(res));
console.log('tagged', n, 'of', Object.keys(dict).length, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
