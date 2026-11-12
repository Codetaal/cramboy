// Japanese lookup: deinflection and longest match against the real dictionary.
const L = require('../docs/kr/ja-lookup.js');
const dict = require('../docs/kr/ja-dict.json');
const cases = [
  ['行きました', '行く'], ['いきました', '行く'], ['いって', '行く'], ['たべない', '食べる'], ['たべました', '食べる'],
  ['みています', '見る'], ['かいた', '書く'], ['よんで', '読む'], ['はなします', '話す'], ['まって', '待つ'],
  ['しんだ', '死ぬ'], ['あそぼう', '遊ぶ'], ['きました', '来る'], ['しました', 'する'], ['おおきかった', '大きい'],
  ['たのしくない', '楽しい'], ['ようこそ', 'ようこそ'], ['ポケモンセンター', 'ポケモンセンター'], ['ピカチュウ', 'ピカチュウ'],
  ['せかいへ', '世界'], ['はかせが', 'はかせ'], ['たいあたり', 'たいあたり'], ['がんばって', '頑張る'], ['もっています', '持つ'],
  ['かえってきた', '帰る'], ['わたしの', '私'], ['きみは', '君'], ['いっしょに', '一緒に'], ['つよい', '強い'], ['よろしく', 'よろしく'],
];
let ok = 0;
for (const [text, want] of cases) {
  const r = L.lookup(dict, text);
  const words = r.hits.map(h => h.word + (h.reading ? '(' + h.reading + ')' : ''));
  const hit = r.hits.some(h => h.word === want || h.reading === want);
  if (hit) ok++;
  console.log((hit ? 'ok  ' : 'MISS') + ' ' + text + ' -> [' + r.matched + '] ' + words.slice(0, 3).join(', ') + (r.hits[0] && r.hits[0].how ? '  {' + r.hits[0].how + '}' : ''));
}
console.log(ok + '/' + cases.length + ' found');
if (ok < cases.length - 2) process.exit(1);
