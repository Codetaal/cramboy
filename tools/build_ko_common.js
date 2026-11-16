// Builds docs/kr/ko-common.json: the dictionary words that are common in everyday spoken Korean, so the
// app can mark the others as "rare word". Source: word counts from OpenSubtitles (FrequencyWords by
// Hermit Dave, https://github.com/hermitdave/FrequencyWords, content CC BY-SA 4.0), tools/data/ko_50k.txt.
// Each counted form (내가, 했어) is traced to its dictionary word (나, 하다) with the ko-dic analyzer.
// Run: node tools/build_ko_common.js (needs lindera-wasm-ko-dic-nodejs).
const fs = require('fs');
const { TokenizerBuilder } = require('lindera-wasm-ko-dic-nodejs');
const b = new TokenizerBuilder(); b.setDictionary('embedded://ko-dic'); const tk = b.build();
const dict = JSON.parse(fs.readFileSync(__dirname + '/../docs/kr/dict.json', 'utf8'));
const KEEP = Number(process.argv[2] || 5000);   // this many most common dictionary words count as common

const count = {};
for (const line of fs.readFileSync(__dirname + '/data/ko_50k.txt', 'utf8').split('\n')) {
  const [form, n] = line.trim().split(/\s+/); if (!form || !/[가-힣]/.test(form)) continue;
  const toks = tk.tokenize(form);
  for (const t of toks) {
    const d = t.details, tag = d[0].split('+')[0];
    if (/^(J|E|X|S)/.test(tag)) continue;                       // particles, endings, suffixes, symbols
    const first = d[7] && d[7] !== '*' ? d[7].split('+')[0].split('/')[0] : t.surface;
    const lemma = /^(VV|VA|VX)$/.test(tag) ? first + '다' : first;
    if (dict[lemma]) count[lemma] = (count[lemma] || 0) + Number(n);
    if (/^(VV|VA|VX)$/.test(tag) || /^N/.test(tag)) {
      // 공부하다: the noun + 하다 form is the dictionary word too
      const next = toks[toks.indexOf(t) + 1];
      if (next && /^XS[VA]/.test(next.details[0]) && dict[t.surface + '하다']) count[t.surface + '하다'] = (count[t.surface + '하다'] || 0) + Number(n);
    }
    break;   // the first content word of the form
  }
}
// Pokémon-world words (the extra terms in tools/build_dict.py) are everyday words in these games.
const GAME = ['포켓몬', '포켓몬스터', '몬스터볼', '포켓몬센터', '프렌들리숍', '체육관', '관장', '배지', '트레이너', '도감', '포켓몬도감', '박사', '라이벌',
  '기술', '레벨', '진화', '배틀', '승부', '사천왕', '챔피언', '포켓기어', '경험치', '상태이상', '기절', '도로', '마을', '시티', '연구소', '엄마'];
const top = Object.keys(count).sort((a, c) => count[c] - count[a]).slice(0, KEEP);
GAME.forEach(w => { if (dict[w] && top.indexOf(w) < 0) top.push(w); });
fs.writeFileSync(__dirname + '/../docs/kr/ko-common.json', JSON.stringify(top.join('|')));
console.log('words counted', Object.keys(count).length, 'kept', top.length, 'last kept:', top.slice(-5).join(' '), count[top[top.length - 1]]);
