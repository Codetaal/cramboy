const assert = require('assert');
global.KRLookupJa = require(__dirname + '/../docs/kr/ja-lookup.js');
const G = require(__dirname + '/../docs/kr/ja-grammar.js');
const dict = require(__dirname + '/../docs/kr/ja-dict.json');
function chunks(line) { return G.find(dict, line).map(c => [c.text, c.verbs.join('+'), c.patterns.map(p => p.id).join('+')]); }
function check(line, want) { assert.deepStrictEqual(chunks(line), want, line); }
check('つかって みれば わかるのよ', [['つかって みれば', '使う', 'ja-te-miru']]);
check('つかって　みれば　わかるのよ', [['つかって　みれば', '使う', 'ja-te-miru']]);   // Gen 5 full-width spaces
check('バトルが できるように なった', [['できるように なった', 'できる', 'ja-you-ni-naru']]);
check('いかなければ ならない', [['いかなければ ならない', '行く', 'ja-nakereba']]);
check('たべても いいよ', [['たべても いい', '食べる', 'ja-te-mo-ii']]);
check('ポケモンを つかまえる ことが できる', [['つかまえる ことが できる', '捕まえる', 'ja-koto-ga-dekiru']]);
check('わすれて しまった！', [['わすれて しまった', '忘れる', 'ja-te-shimau']]);
check('くさむらに はいっては いけない！', [['はいっては いけない', '入る', 'ja-te-wa-ikenai']]);
check('いかないで ください', [['いかないで ください', '行く', 'ja-naide-kudasai']]);
check('わたしは ここに いる', []);
assert.strictEqual(G.ending('いいよ').form, '〜よ');
console.log('ja grammar ok');
