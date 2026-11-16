// Korean grammar patterns: finds multi-word patterns like "알 수 있다" (-(으)ㄹ 수 있다, "can") so the
// subtitles show them as one chunk, and explains the verb, the pattern and the ending.
(function (root) {
  'use strict';

  var SYL0 = 0xAC00;
  function isSyl(c) { var x = c ? c.charCodeAt(0) : 0; return x >= 0xAC00 && x <= 0xD7A3; }
  function parts(c) { var x = c.charCodeAt(0) - SYL0; return { cho: Math.floor(x / 588), jung: Math.floor(x % 588 / 28), jong: x % 28 }; }
  function make(cho, jung, jong) { return String.fromCharCode(SYL0 + cho * 588 + jung * 28 + (jong || 0)); }
  var J_L = 8, J_N = 4, J_B = 17, C_NG = 11, C_R = 5;   // final ㄹ, final ㄴ, final ㅂ; initial ㅇ, initial ㄹ
  // Vowels (jung index): ㅏ0 ㅐ1 ㅓ4 ㅔ5 ㅕ6 ㅗ8 ㅘ9 ㅙ10 ㅚ11 ㅜ13 ㅝ14 ㅡ18 ㅣ20
  // A contracted -아/어 syllable (써 = 쓰 + 어) -> the vowels its verb stem may have had.
  var UNCONTRACT = { 0: [0], 1: [1], 4: [18, 4], 5: [5], 6: [20, 6], 9: [8], 10: [11], 14: [13] };

  // Connector types: what comes right before the pattern.
  //  L: -(으)ㄹ   N: -(으)ㄴ / -는 / -던   A: -아 / -어 (also contracted: 써, 봐, 해)   S: the bare verb stem
  // tail: what follows (a regex at the split point; " ?" because spacing varies: 써보면 / 써 보면).
  var P = [
    ['l-su-bakke', 'L', /^ ?수(?:밖에| ?밖에) ?없/, '-(으)ㄹ 수밖에 없다', 'have no choice but to', '그럴 수밖에 없어 = it can only be that way'],
    ['l-su-itda', 'L', /^ ?수(?:가|도|는)? ?있/, '-(으)ㄹ 수 있다', 'can, be able to', '갈 수 있어 = I can go'],
    ['l-su-eopda', 'L', /^ ?수(?:가|도|는)? ?없/, '-(으)ㄹ 수 없다', 'cannot, be unable to', '갈 수 없어 = I can’t go'],
    ['l-geot-gatda', 'L', /^ ?(?:것|거) ?같/, '-(으)ㄹ 것 같다', 'I think it will…, it looks like it will…', '비가 올 것 같아 = looks like it’s going to rain'],
    ['l-geoya', 'L', /^ ?(?:거|것|겁)(?=야|예요|에요|이에요|이다|입니다|니|다|라|지|죠|래|$|[ !?.…])/, '-(으)ㄹ 거야', 'will, going to (also a guess: probably)', '내일 갈 거야 = I’ll go tomorrow'],
    ['l-ttae', 'L', /^ ?때/, '-(으)ㄹ 때', 'when (doing)', '잘 때 = when sleeping'],
    ['l-jul-alda', 'L', /^ ?줄 ?(?:알|아는|아니|몰|모르|모른)/, '-(으)ㄹ 줄 알다 / 모르다', 'know / don’t know how to', '수영할 줄 알아? = can you swim?'],
    ['l-manhada', 'L', /^ ?만 ?(?:하|해|했|한|합)/, '-(으)ㄹ 만하다', 'worth doing', '볼 만해 = it’s worth seeing'],
    ['n-geot-gatda', 'N', /^ ?(?:것|거) ?같/, '-(으)ㄴ/는 것 같다', 'it seems (that)…, I think…', '아는 것 같아 = seems to know'],
    ['n-jeok', 'N', /^ ?적(?:이|은|도)? ?(?:있|없)/, '-(으)ㄴ 적이 있다 / 없다', 'have (never) done before', '가 본 적 있어 = I’ve been there'],
    ['n-hue', 'N', /^ ?(?:후|뒤|다음)(?:에)?(?=[ !?.…,]|$|에)/, '-(으)ㄴ 후에', 'after doing', '먹은 후에 = after eating'],
    ['n-dongan', 'N', /^ ?동안/, '-는 동안', 'while', '자는 동안 = while sleeping'],
    ['n-cheok', 'N', /^ ?척/, '-(으)ㄴ/는 척하다', 'pretend to', '모르는 척 = pretending not to know'],
    ['n-jul-alda', 'N', /^ ?줄 ?(?:알|몰)/, '-(으)ㄴ/는 줄 알다 / 몰랐다', 'thought (wrongly) that / didn’t know that', '간 줄 알았어 = I thought you’d gone'],
    ['n-ji', 'N', /^ ?지 ?(?:모르|몰|알|아)/, '-(으)ㄴ/는지 알다 / 모르다', 'know / don’t know whether, what, how…', '어디 있는지 몰라 = I don’t know where it is'],
    ['n-geot', 'N', /^ ?(?:것|거)(?=은|이|을|도|는|야|예요|에요|이에요|이다|입니다|만|$|[ !?.…,])/, '-(으)ㄴ/는 것', 'turns a verb into a noun: “(the) doing, the fact that”', '보는 것 = watching / what you see'],
    ['a-ya-hada', 'A', /^야 ?(?:하|해|했|할|한|합|돼|되|됐|될|된|됩)/, '-아/어야 하다 / 되다', 'have to, must', '가야 해 = I have to go'],
    ['a-yaji', 'A', /^야지/, '-아/어야지', 'should, (I) ought to / I’d better', '자야지 = I should sleep'],
    ['a-do-doeda', 'A', /^도 ?(?:돼|되|된|됩|괜찮|좋)/, '-아/어도 되다', 'may, it’s okay to', '가도 돼 = you may go'],
    ['a-boda', 'A', /^ ?(?:보|봐|봤|볼|본|봅|봐요)/, '-아/어 보다', 'try doing (and see)', '해 봐 = give it a try'],
    ['a-juda', 'A', /^ ?(?:주|줘|줬|줄|준|줍|드리|드려|드렸|드릴|드립)/, '-아/어 주다', 'do (something) for someone', '도와줘 = help me (do me the favour)'],
    ['a-itda', 'A', /^ ?(?:있|계시|계세)/, '-아/어 있다', 'is in a state of (having done): sitting, open, written…', '앉아 있어 = is sitting'],
    ['a-beorida', 'A', /^ ?(?:버리|버려|버렸|버린|버릴|버립)/, '-아/어 버리다', 'do completely / end up doing (often with regret or relief)', '잊어버렸어 = I totally forgot'],
    ['a-nota', 'A', /^ ?(?:놓|놔|놨|놀|둬|뒀|두|둔|둘)/, '-아/어 놓다 / 두다', 'do in advance, leave (it) done', '사 놓았어 = I bought it in advance'],
    ['go-itda', 'S', /^고 ?(?:있|계시|계세|계신|계셔|계셨)/, '-고 있다', 'is doing (right now)', '기다리고 있어 = I’m waiting'],
    ['reo-gada', 'S', /^(?:으)?러 ?(?:가|와|오|갔|왔|간|온|갈|올|갑|옵)/, '-(으)러 가다 / 오다', 'go / come (in order) to do', '포켓몬을 받으러 가자 = let’s go get a Pokémon'],
    ['go-sipda', 'S', /^고 ?싶/, '-고 싶다', 'want to', '보고 싶어 = I want to see (I miss you)'],
    ['go-malda', 'S', /^고 ?(?:말았|말|만다|말겠)/, '-고 말다', 'end up doing; (with 겠) will surely do', '잃고 말았어 = ended up losing it'],
    ['go-nada', 'S', /^고 ?나(?:서|면|니|면서)/, '-고 나서', 'after (finishing) doing', '먹고 나서 = after eating'],
    ['ji-anta', 'S', /^지 ?(?:않|안)/, '-지 않다', 'not (do), not (be)', '어렵지 않아 = it’s not hard'],
    ['ji-mothada', 'S', /^지 ?못/, '-지 못하다', 'cannot, fail to', '자지 못했어 = I couldn’t sleep'],
    ['ji-malda', 'S', /^지 ?(?:마|말)/, '-지 마(세요)', 'don’t (do)!', '가지 마 = don’t go'],
    ['gi-ttaemun', 'S', /^기 ?때문/, '-기 때문에', 'because', '늦었기 때문에 = because I was late'],
    ['gi-jeon', 'S', /^기 ?전/, '-기 전에', 'before doing', '자기 전에 = before sleeping'],
    ['gi-wihae', 'S', /^기 ?위(?:해|한|하)/, '-기 위해', 'in order to', '이기기 위해 = in order to win'],
    ['gi-sijak', 'S', /^기 ?시작/, '-기 시작하다', 'start doing', '비가 오기 시작했어 = it started to rain'],
    ['giro-hada', 'S', /^기로 ?(?:하|해|했|한|합)/, '-기로 하다', 'decide to', '가기로 했어 = we decided to go'],
    ['ge-doeda', 'S', /^게 ?(?:되|돼|됐|될|된|됩)/, '-게 되다', 'come to (do), end up (doing)', '알게 됐어 = I came to know / found out'],
    ['ge-hada', 'S', /^게 ?(?:하|해|했|할|한|합|만들)/, '-게 하다', 'make / let (someone) do', '웃게 해 = makes me laugh'],
    ['ryeogo-hada', 'S', /^(?:으)?려고 ?(?:하|해|했|한|합)/, '-(으)려고 하다', 'intend to, be about to', '가려고 해 = I’m about to go'],
    ['myeon-an-doeda', 'S', /^(?:으)?면 ?안 ?(?:돼|되|된|됩)/, '-(으)면 안 되다', 'must not', '가면 안 돼 = you must not go'],
    ['myeon-doeda', 'S', /^(?:으)?면 ?(?:돼|되|된|됩)/, '-(으)면 되다', 'you just have to, it’s enough to', '누르면 돼 = just press it']
  ];

  // Endings at the end of a chunk: what the last bit adds (longest first).
  var ENDINGS = [
    ['는단다', 'telling something warmly, like a parent: “…, you know”'], ['단다', 'telling something warmly, like a parent: “…, you know”'],
    ['란다', 'telling something warmly: “…, you know”'], ['잖아', '“…, you know (as you’re aware)”'], ['거든', 'giving the reason: “…, you see”'],
    ['는구나', 'realising: “oh, so …!”'], ['구나', 'realising: “oh, so …!”'], ['군요', 'realising, polite: “oh, I see …”'],
    ['네요', 'noticing, polite: “oh, …!”'], ['을게', 'promise: “I’ll …”'], ['ㄹ게', 'promise: “I’ll …”'], ['게요', 'promise, polite: “I’ll …”'],
    ['을래', '“want to …? / I’ll …”'], ['래요', 'polite “want to …?” or “they say …”'], ['을까', '“shall I/we …?” or “I wonder if …”'],
    ['세요', 'polite request or statement'], ['십시오', 'formal request: “please …”'], ['습니다', 'formal polite statement'], ['ㅂ니다', 'formal polite statement'],
    ['니까', 'because, since'], ['는데', 'background: “…, and / but …”'], ['은데', 'background: “…, and / but …”'], ['면서', 'while …'],
    ['어서', '“so, and then”'], ['아서', '“so, and then”'], ['해서', '“so, and then”'], ['려고', 'in order to'], ['으면', 'if, when'], ['면', 'if, when'],
    ['자', 'let’s …'], ['지?', '“…, right?”'], ['니?', 'question (to a friend or child)'], ['냐', 'question (casual)'], ['고', 'and'], ['요', 'polite']
  ];

  // Syllables in which the stem of the verb may sit: candidates for its dictionary form.
  function verbCands(left, type) {
    var out = [], last = left.slice(-1), head = left.slice(0, -1);
    if (!isSyl(last)) return out;
    var p = parts(last);
    function add(s) { if (s && out.indexOf(s) < 0) out.push(s); }
    if (type === 'S') { stemCands(left).forEach(add); return out; }
    if (type === 'L') {
      if (last === '을' && head) { add(head + '다'); if (/[^가-힣]/.test(head) === false) { var hp = parts(head.slice(-1)); if (hp.jong === 0) add(head + '다'); } }
      else if (p.jong === J_L) { add(head + make(p.cho, p.jung) + '다'); add(left + '다'); }
      return out;
    }
    if (type === 'N') {
      if ((last === '은' || last === '는' || last === '던') && head) stemCands(head).forEach(add);
      else if (p.jong === J_N) { add(head + make(p.cho, p.jung) + '다'); add(head + make(p.cho, p.jung, J_L) + '다'); }
      else if (last === '던') add(head + '다');
      return out;
    }
    // A: 먹어, 가, 써, 봐, 해, 몰라, 도와
    if (p.jong !== 0) return out;
    if ((last === '아' || last === '어' || last === '여') && head) {
      add(head + '다');
      var q = parts(head.slice(-1));
      if (last === '여' && head.slice(-1) === '하') add(head + '다');
      // ㅂ-irregular is 와/워 below; 르-irregular: 몰라 -> 모르다
      if (q.jong === J_L) add(head.slice(0, -1) + make(q.cho, q.jung) + '르다');
    }
    if (last === '해') add(head + '하다');
    if ((last === '와' || last === '워') && head) { var h2 = parts(head.slice(-1)); if (h2.jong === 0) add(head.slice(0, -1) + make(h2.cho, h2.jung, J_B) + '다'); }
    if ((last === '라' || last === '러') && head) { var h3 = parts(head.slice(-1)); if (h3.jong === J_L) add(head.slice(0, -1) + make(h3.cho, h3.jung) + '르다'); }
    (UNCONTRACT[p.jung] || []).forEach(function (v) { add(head + make(p.cho, v) + '다'); });
    if (p.jung === 1) add(head + '하다');   // 해-like 내 is 내다; 해 handled above
    return out;
  }
  // A verb stem, maybe with past / future / honorific markers (늦었, 갔, 했, 가겠, 가셨): its dictionary forms.
  function stemCands(stem) {
    var out = [];
    function add(s) { if (s && out.indexOf(s) < 0) out.push(s); }
    add(stem + '다');
    var last = stem.slice(-1), head = stem.slice(0, -1);
    if (!isSyl(last) || !head && last.length === 0) return out;
    if ((last === '었' || last === '았' || last === '였' || last === '겠' || last === '시' || last === '셨') && head) stemCands(head).forEach(add);
    if (last === '했') add(head + '하다');
    var p = parts(last);
    if (p.jong === 20 && last !== '었' && last !== '았' && last !== '였') {   // contracted past: 갔 봤 됐 썼
      (UNCONTRACT[p.jung] || [p.jung]).forEach(function (v) { add(head + make(p.cho, v) + '다'); });
      if (p.jung === 1) add(head + '하다');
    }
    return out;
  }
  function isLeftType(left, type) {
    var last = left.slice(-1);
    if (!isSyl(last)) return false;
    var p = parts(last);
    if (type === 'L') return p.jong === J_L || last === '을';
    if (type === 'N') return p.jong === J_N || last === '은' || last === '는' || last === '던';
    if (type === 'A') return p.jong === 0 && (last === '아' || last === '어' || last === '여' || UNCONTRACT[p.jung] !== undefined);
    return true;
  }
  // The verb's meaning: its "to …" senses first (the dictionary lists 알다 as "wise; To know").
  function firstSense(g) {
    var all = String(g || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    var verbs = all.filter(function (x) { return /^to /i.test(x); });
    if (verbs.length) verbs.sort(function (a, b) { return a.length - b.length; });
    return (verbs.length ? verbs : all).slice(0, 2).join('; ');
  }

  // Find grammar chunks in one line of text. Returns [{start, end, text, verb, verbGloss, patterns: [...], ending}].
  // dict: word -> gloss (needed to be sure the word before the pattern is a real verb).
  function find(dict, line) {
    var hits = [], i, n = line.length;
    for (var p = 1; p < n; p++) {
      if (!isSyl(line.charAt(p - 1))) continue;
      var ws = p - 1; while (ws > 0 && isSyl(line.charAt(ws - 1))) ws--;
      var left = line.slice(ws, p), rest = line.slice(p);
      for (i = 0; i < P.length; i++) {
        var pat = P[i], m = pat[2].exec(rest);
        if (!m || !isLeftType(left, pat[1])) continue;
        if (pat[0] === 'a-boda' && /^보다(?:[^가-힣]|$)/.test(rest)) continue;   // 나보다 = "than me", not "try"
        if (pat[0] === 'ge-hada' && /^[어이그저]떻$|^[이그저]렇$/.test(left)) continue;   // 어떻게 하다 = "how to do"
        var cands = verbCands(left, pat[1]), verb = '';
        for (var c = 0; c < cands.length; c++) if (!dict || dict[cands[c]]) { verb = cands[c]; break; }
        if (!verb) continue;
        var e = p + m[0].length; while (e < n && isSyl(line.charAt(e))) e++;
        hits.push({ start: ws, end: e, verb: verb, verbGloss: dict ? firstSense(dict[verb]) : '', pattern: { id: pat[0], label: pat[3], en: pat[4], ex: pat[5] } });
        break;   // one pattern per split point (the list is ordered most specific first)
      }
    }
    // Merge overlapping chunks (먹어 보고 싶어 = -아 보다 + -고 싶다).
    hits.sort(function (a, b) { return a.start - b.start; });
    var out = [];
    hits.forEach(function (h) {
      var o = out[out.length - 1];
      if (o && h.start < o.end) {
        o.end = Math.max(o.end, h.end);
        if (!o.patterns.some(function (x) { return x.id === h.pattern.id; })) o.patterns.push(h.pattern);
        if (o.verbs.indexOf(h.verb) < 0 && !HELPER[h.verb]) { o.verbs.push(h.verb); o.glosses.push(h.verbGloss); }
      } else out.push({ start: h.start, end: h.end, patterns: [h.pattern], verbs: [h.verb], glosses: [h.verbGloss] });
    });
    out.forEach(function (o) {
      o.text = line.slice(o.start, o.end);
      o.ending = ending(o.text);
    });
    return out;
  }
  function ending(text) {
    var t = text.replace(/[^가-힣?]+$/g, '').replace(/[^가-힣]+(?=\?$)/, '');
    for (var i = 0; i < ENDINGS.length; i++) {
      var e = ENDINGS[i][0];
      if (e.charAt(0) === 'ㄹ' || e.charAt(0) === 'ㅂ') {
        // ㄹ게 / ㅂ니다: the consonant is the final of the syllable before.
        var rest = e.slice(1), body = t.slice(0, t.length - rest.length);
        if (rest && t.slice(-rest.length) === rest && body && isSyl(body.slice(-1)) && parts(body.slice(-1)).jong === (e.charAt(0) === 'ㄹ' ? J_L : J_B)) return { form: '-' + e, en: ENDINGS[i][1] };
        continue;
      }
      if (e.slice(-1) === '?') { if (t.slice(-e.length) === e) return { form: '-' + e.slice(0, -1), en: ENDINGS[i][1] }; continue; }
      var tt = t.replace(/\?$/, '');
      if (tt.length > e.length && tt.slice(-e.length) === e) return { form: '-' + e, en: ENDINGS[i][1] };
    }
    return null;
  }

  // Verbs that are part of a pattern when chunks merge (먹어 보고 싶어: 보다 is the pattern, not a second verb).
  var HELPER = { '보다': 1, '주다': 1, '있다': 1, '않다': 1, '없다': 1, '되다': 1, '버리다': 1, '놓다': 1, '두다': 1 };
  // Pieces of a pattern that are not words worth learning on their own.
  var FILLER = { '수': 1, '것': 1, '거': 1, '줄': 1, '적': 1, '척': 1, '때문': 1 };

  var api = { find: find, ending: ending, verbCands: verbCands, patterns: P, byId: function (id) { for (var i = 0; i < P.length; i++) if (P[i][0] === id) return { id: id, label: P[i][3], en: P[i][4], ex: P[i][5] }; return null; }, FILLER: FILLER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KRGrammar = api;
})(this);
