const L = require(__dirname + '/../docs/kr/lookup.js');
const dict = require(__dirname + '/../docs/kr/dict.json');
const cases = ['포켓몬의','세계에','왔단다!','박사란다.','피카츄가','나타났다!','갑니다','봤어요','몬스터볼을','공격했다','친구랑','체육관에서','잡았다','싸우고','모험을','기다리고','있어','좋아!','도와줄게'];
let ok = 0;
for (const w of cases) {
  const h = L.lookup(dict, w, 2);
  if (h.length) ok++;
  console.log(w.padEnd(8), '→', h.map(x => `${x.word} [${x.how||'exact'}] ${x.gloss.slice(0,40)}`).join(' | ') || '(none)');
}
console.log(`${ok}/${cases.length} found`);
