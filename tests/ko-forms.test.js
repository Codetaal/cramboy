const assert = require('assert');
const L = require(__dirname + '/../docs/kr/lookup.js');
const dict = require(__dirname + '/../docs/kr/dict.json');
L.setForms(require(__dirname + '/../docs/kr/ko-forms.json'));
const top = s => (L.lookup(dict, s, 3)[0] || {}).word;
// Irregular verbs found through the analyzer-checked form table
[['몰라', '모르다'], ['추워서', '춥다'], ['불렀어', '부르다'], ['들으면', '듣다'], ['썼다', '쓰다'], ['도와', '돕다'], ['그래요', '그렇다'], ['만듭니다', '만들다']]
  .forEach(([s, v]) => assert.strictEqual(top(s), v, s));
// Breakdowns
assert.deepStrictEqual(L.breakdown('썼다', '쓰다'), ['쓰', '었다']);
assert.deepStrictEqual(L.breakdown('몰라', '모르다'), ['모르', '아']);
assert.deepStrictEqual(L.breakdown('추워서', '춥다'), ['춥', '어서']);
assert.deepStrictEqual(L.breakdown('들으면', '듣다'), ['듣', '으면']);
assert.deepStrictEqual(L.breakdown('먹었어', '먹다'), ['먹', '었어']);
assert.strictEqual(L.breakdown('가', '가다'), null);
console.log('ko forms ok');
