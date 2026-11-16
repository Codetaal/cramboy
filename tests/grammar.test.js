const assert = require('assert');
const G = require(__dirname + '/../docs/kr/grammar.js');
const dict = require(__dirname + '/../docs/kr/dict.json');

function chunks(line) { return G.find(dict, line).map(c => [c.text, c.verbs.join('+'), c.patterns.map(p => p.id).join('+'), c.ending ? c.ending.form : '']); }
function check(line, want) { assert.deepStrictEqual(chunks(line), want, line); }

// The case from the game: two chunks, verb + pattern + ending.
check('아무튼 터치해서 써보면 알 수 있단다', [['써보면', '쓰다', 'a-boda', '-면'], ['알 수 있단다', '알다', 'l-su-itda', '-단다']]);
check('너도 갈 수 있어', [['갈 수 있어', '가다', 'l-su-itda', '']]);
check('그럴 수가 없어', [['그럴 수가 없어', '그러다', 'l-su-eopda', '']]);
check('만들 수 있어', [['만들 수 있어', '만들다', 'l-su-itda', '']]);
check('공부할 수 있다', [['공부할 수 있다', '공부하다', 'l-su-itda', '']]);
check('내일 갈 거야', [['갈 거야', '가다', 'l-geoya', '']]);
check('이 집에 사는 것 같아', [['사는 것 같아', '사다', 'n-geot-gatda', '']]);
check('포켓몬을 데리고 가야 해', [['가야 해', '가다', 'a-ya-hada', '']]);
check('해 봐!', [['해 봐!', '하다', 'a-boda', '']].map(x => [x[0].replace('!', ''), x[1], x[2], x[3]]));
check('도와줘!', [['도와줘', '돕다', 'a-juda', '']]);
check('늦었기 때문에', [['늦었기 때문에', '늦다', 'gi-ttaemun', '']]);
check('엄마가 기다리고 계셔', [['기다리고 계셔', '기다리다', 'go-itda', '']]);
check('포켓몬을 받으러 가자', [['받으러 가자', '받다', 'reo-gada', '-자']]);
check('먹어 보고 싶어', [['먹어 보고 싶어', '먹다', 'a-boda+go-sipda', '']]);
check('무슨 일이 있어도 포기하지 않을 거야', [['포기하지 않을 거야', '포기하다', 'ji-anta+l-geoya', '']]);
check('가면 안 돼', [['가면 안 돼', '가다', 'myeon-an-doeda', '']]);
// Not grammar patterns.
check('나보다 강해!', []);
check('어디 있어?', []);
check('여기 있어', []);
check('이건 내 거야', []);
check('어떻게 하는지 몰라', [['하는지 몰라', '하다', 'n-ji', '']]);
// Endings on their own.
assert.strictEqual(G.ending('있단다').form, '-단다');
assert.strictEqual(G.ending('갈게').form, '-ㄹ게');
assert.strictEqual(G.ending('있어'), null);
console.log('grammar ok');
