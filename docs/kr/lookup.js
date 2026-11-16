// Dictionary lookup that copes with Korean particles and common verb endings.
(function (root) {
  'use strict';

  var PARTICLES = ['에게서는', '으로부터', '에서부터', '에서는', '에게서', '에게는', '으로는', '이라고', '이라는',
    '한테서', '까지는', '에서도', '에게도', '이라도', '이랑', '처럼', '보다', '마다', '부터', '까지', '에게', '한테',
    '에서', '으로', '라고', '라는', '이나', '이야', '이여', '께서', '조차', '밖에', '만큼', '에는', '에도', '에만', '은', '는', '이', '가',
    '을', '를', '의', '에', '도', '만', '와', '과', '로', '랑', '나', '야', '요', '께', '아'];

  var ENDINGS = ['었습니다', '았습니다', '였습니다', '했습니다', '겠습니다', '습니다', '습니까', '었어요', '았어요',
    '였어요', '했어요', '겠어요', '세요', '으세요', '십시오', '으십시오', '어요', '아요', '해요', '었다', '았다', '였다',
    '했다', '겠다', '었어', '았어', '했어', '어서', '아서', '해서', '하고', '하면', '하는', '한다', '는다', '는데',
    '은데', '인데', '지만', '네요', '군요', '구나', '거든', '니까', '으니까', '으면', '으며', '면서', '려고', '으려고',
    '고', '지', '면', '며', '서', '어', '아', '자', '죠', '네', '게', '기', '음', '는', '은', '을', '던', '다', '요'];

  var SYL0 = 0xAC00;
  function isSyl(c) { var x = c.charCodeAt(0); return x >= 0xAC00 && x <= 0xD7A3; }
  function parts(c) { var x = c.charCodeAt(0) - SYL0; return { cho: Math.floor(x / 588), jung: Math.floor(x % 588 / 28), jong: x % 28 }; }
  function make(p) { return String.fromCharCode(SYL0 + p.cho * 588 + p.jung * 28 + p.jong); }
  var JONG_B = 17, JONG_SS = 20, JONG_N = 4, JONG_L = 8;
  // contracted vowels (verb stem + 아/어): ㅘ->ㅗ, ㅝ->ㅜ, ㅕ->ㅣ, ㅐ->ㅏ(하)
  var UNCONTRACT = { 9: 8, 14: 13, 6: 20 };

  function clean(w) {
    return w.replace(/[​·.,!?…~"'“”‘’()\[\]{}:;\-—\s0-9]/g, '');
  }

  // Irregular and contracted verb forms the rules below can't undo (들으면 -> 듣다, 몰라 -> 모르다, 써 -> 쓰다),
  // checked with a morphological analyzer when the dictionary is built (tools/build_ko_forms.js).
  // Set by the app: { form: verb }.
  var FORMS = null;
  function setForms(byVerb) {
    FORMS = {};
    for (var v in byVerb) byVerb[v].split('|').forEach(function (f) { FORMS[f] = v; });
  }

  // Candidate dictionary forms for a word as it appears in text.
  function candidates(word) {
    var w = clean(word), out = [], seen = {};
    function add(s, how) { if (s && !seen[s]) { seen[s] = 1; out.push({ form: s, how: how }); } }
    if (!w) return out;
    add(w, '');
    var stems = [w];
    PARTICLES.forEach(function (p) {
      if (w.length > p.length && w.slice(-p.length) === p) { var s = w.slice(0, -p.length); add(s, 'particle ' + p); stems.push(s); }
    });
    stems.slice().forEach(function (base) {
      ENDINGS.forEach(function (e) {
        if (base.length > e.length && base.slice(-e.length) === e) {
          var s = base.slice(0, -e.length);
          if (/^(했|해|하)/.test(e)) add(s + '하다', 'verb'); else add(s + '다', 'verb');
          add(s, 'stem');
          stems.push(s);
        }
      });
    });
    // Known irregular forms go first, right after the word itself.
    if (FORMS) {
      var front = [];
      stems.forEach(function (s) { var f = FORMS[s]; if (f && !seen['#' + f]) { seen['#' + f] = 1; front.push({ form: f, how: 'verb' }); } });
      if (front.length) {
        out = [out[0]].concat(front, out.slice(1).filter(function (c) { return !front.some(function (x) { return x.form === c.form; }); }));
        front.forEach(function (x) { seen[x.form] = 1; });
      }
    }
    // Syllable-level verb forms: 갑니다 -> 가다, 갔다 -> 가다, 봤어 -> 보다, 했다 -> 하다
    stems.forEach(function (s) {
      for (var cut = 1; cut <= Math.min(3, s.length); cut++) {
        var head = s.slice(0, s.length - cut), last = s.charAt(s.length - cut);
        if (!isSyl(last)) continue;
        var p = parts(last);
        if (p.jong === JONG_B || p.jong === JONG_SS || p.jong === JONG_N || p.jong === JONG_L) {
          var q = { cho: p.cho, jung: p.jung, jong: 0 };
          add(head + make(q) + '다', 'verb');
          if (UNCONTRACT[p.jung] !== undefined) { q.jung = UNCONTRACT[p.jung]; add(head + make(q) + '다', 'verb'); }
          if (p.jong === JONG_N) { add(head + make({ cho: p.cho, jung: p.jung, jong: JONG_L }) + '다', 'verb'); }
        }
        if (p.jong === 0 && UNCONTRACT[p.jung] !== undefined) {
          add(head + make({ cho: p.cho, jung: UNCONTRACT[p.jung], jong: 0 }) + '다', 'verb');
        }
        if (last === '해' || last === '했') add(head + '하다', 'verb');
      }
    });
    return out;
  }

  function lookup(dict, word, max) {
    max = max || 4;
    var hits = [], used = {};
    candidates(word).forEach(function (c) {
      if (hits.length < max && dict[c.form] && !used[c.form]) { used[c.form] = 1; hits.push({ word: c.form, gloss: dict[c.form], how: c.how }); }
    });
    // Longest known prefix as a last resort (compounds, unusual endings)
    var w = clean(word);
    if (hits.length === 0) {
      for (var n = w.length - 1; n >= 2; n--) {
        var pre = w.slice(0, n);
        if (dict[pre] && !used[pre]) { hits.push({ word: pre, gloss: dict[pre], how: 'prefix' }); break; }
        if (dict[pre + '다'] && !used[pre + '다']) { hits.push({ word: pre + '다', gloss: dict[pre + '다'], how: 'prefix' }); break; }
      }
    }
    return hits;
  }

  // How a verb form is built: breakdown('썼다', '쓰다') -> ['쓰', '었다']; ('들으면', '듣다') -> ['듣', '으면'].
  // Undoes the contractions and irregular changes; returns null when it can't tell.
  var BRIGHT = { 0: 1, 8: 1, 9: 1 };
  function breakdown(surface, base) {
    surface = clean(surface);
    if (!/다$/.test(base) || !surface) return null;
    var stem = base.slice(0, -1);
    if (surface === stem) return null;
    if (surface.indexOf(stem) === 0) return [stem, surface.slice(stem.length)];
    var p = 0; while (p < stem.length && p < surface.length && stem.charAt(p) === surface.charAt(p)) p++;
    var a = stem.charAt(p), u = surface.charAt(p), rest = surface.slice(p + 1), stemRest = stem.slice(p + 1);
    if (!a || !u || !isSyl(a) || !isSyl(u)) return null;
    var A = parts(a), U = parts(u);
    var swap = function (r, map) { var f = r.charAt(0); return map[f] ? map[f] + r.slice(1) : null; };
    var AO = { '와': '아', '워': '어', '왔': '았', '웠': '었', '우': '으', '라': '아', '러': '어', '랐': '았', '렀': '었' };
    // 르: 모르 -> 몰라 / 몰랐
    if (stemRest === '르' && U.jong === JONG_L && U.cho === A.cho) { var r1 = swap(rest, AO); return r1 ? [stem, r1] : null; }
    if (stemRest) return null;
    if (U.cho === A.cho) {
      // contracted -아/어 (써, 봐, 돼) and past (썼, 갔, 했)
      if (U.jong === 0 && U.jung !== A.jung && !A.jong) return [stem, (a === '하' ? '여' : BRIGHT[A.jung] ? '아' : '어') + rest];
      if (U.jong === JONG_SS && !A.jong) return [stem, (a === '하' ? '였' : BRIGHT[A.jung] ? '았' : '었') + rest];
      if (A.jong === 17 && U.jong === 0 && U.jung === A.jung) { var r2 = swap(rest, AO); return r2 ? [stem, r2] : null; }   // ㅂ: 추워 -> 춥 + 어
      if (A.jong === 7 && U.jong === JONG_L) return [stem, rest];                                               // ㄷ: 들으면 -> 듣 + 으면
      if (A.jong === 19 && U.jong === 0 && U.jung === A.jung) return [stem, rest];                              // ㅅ: 나아 -> 낫 + 아
      if (A.jong === JONG_L && U.jong === 0 && U.jung === A.jung) return [stem, rest];                          // ㄹ dropped: 만드세요 -> 만들 + 세요
      if (A.jong === 27) {                                                                                       // ㅎ: 그래 / 그럴 / 그런
        if (U.jong === 0) return [stem, (BRIGHT[A.jung] ? '아' : '어') + rest];
        if (U.jong === JONG_L) return [stem, '을' + rest];
        if (U.jong === JONG_N) return [stem, '은' + rest];
      }
    }
    return null;
  }

  var api = { candidates: candidates, lookup: lookup, clean: clean, setForms: setForms, breakdown: breakdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KRLookup = api;
})(this);
