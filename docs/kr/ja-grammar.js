// Japanese grammar patterns: finds patterns like "つかって みる" (〜てみる, "try doing") or
// "つかまえる ことが できる" (〜ことができる, "can") so the subtitles show them as one chunk.
// Same result shape as grammar.js (Korean): [{start, end, text, verbs, glosses, patterns, ending}].
(function (root) {
  'use strict';
  var L = root.KRLookupJa || (typeof require !== 'undefined' ? require('./ja-lookup.js') : null);

  // Form of the verb right before the pattern:
  //  TE: te-form (つかって, あそんで)   PLAIN: dictionary / past / negative form (いく, いった, いかない)
  //  MUST: 〜なければ / なきゃ / なくちゃ / ないと   NAIDE: 〜ないで
  // tail: what follows (Pokémon text puts spaces between phrases, so " ?").
  var P = [
    ['ja-te-miru', 'TE', /^ ?み(?:る|て|た|れ|ます|まし|ない|よう|ろ)/, '〜てみる', 'try doing (and see)', 'たべて みる = try eating it'],
    ['ja-te-iru', 'TE', /^ ?(?:い|おり|おる)(?:る|て|た|ます|まし|ない|なさい|ろ|れ)/, '〜ている', 'is doing (now), or a state that lasts', 'まって いる = is waiting'],
    ['ja-te-shimau', 'TE', /^ ?しま(?:う|った|って|います|いました|え)/, '〜てしまう', 'do completely / end up doing (often with regret)', 'わすれて しまった = I totally forgot'],
    ['ja-te-kudasai', 'TE', /^ ?くだ(?:さい|さ)/, '〜てください', 'please do', 'まって ください = please wait'],
    ['ja-te-kureru', 'TE', /^ ?くれ/, '〜てくれる', 'do for me / for us (a favour)', 'てつだって くれ = help me'],
    ['ja-te-ageru', 'TE', /^ ?(?:あげ|やる|やり|やっ)/, '〜てあげる', 'do for someone else', 'おしえて あげる = I’ll teach you'],
    ['ja-te-oku', 'TE', /^ ?お(?:く|いて|いた|き|こう|け)/, '〜ておく', 'do in advance, leave (it) done', 'かって おく = buy it beforehand'],
    ['ja-te-hoshii', 'TE', /^ ?ほし/, '〜てほしい', 'want (someone) to do', 'きて ほしい = I want you to come'],
    ['ja-te-mo-ii', 'TE', /^も ?(?:いい|よい|よろし|かまわ|だいじょうぶ|大丈夫)/, '〜てもいい', 'may, it’s okay to', 'たべても いい = you may eat it'],
    ['ja-te-wa-ikenai', 'TE', /^は ?(?:いけ|だめ|ダメ|ならな)/, '〜てはいけない', 'must not', 'いっては いけない = you must not go'],
    ['ja-nakereba', 'MUST', /^ ?(?:なら|いけ|だめ|ダメ)/, '〜なければならない', 'must, have to', 'いかなければ ならない = I have to go'],
    ['ja-naide-kudasai', 'NAIDE', /^ ?くだ(?:さい|さ)/, '〜ないでください', 'please don’t', 'いかないで ください = please don’t go'],
    ['ja-koto-ga-dekiru', 'PLAIN', /^ ?こと(?:が|も|は)? ?でき/, '〜ことができる', 'can, be able to', 'つかまえる ことが できる = can catch'],
    ['ja-koto-ga-aru', 'PLAIN', /^ ?こと(?:が|も|は)? ?(?:ある|あり|あっ|ない|なか)/, '〜たことがある', 'have (never) done before (after a past verb); sometimes do (after a plain verb)', 'いった ことが ある = I’ve been there'],
    ['ja-you-ni-naru', 'PLAIN', /^ ?ように ?(?:な|成)/, '〜ようになる', 'come to (be able to), start to', 'できる ように なった = became able to'],
    ['ja-you-ni-suru', 'PLAIN', /^ ?ように ?(?:す|し)/, '〜ようにする', 'make sure to, try to', 'わすれない ように する = make sure not to forget'],
    ['ja-tsumori', 'PLAIN', /^ ?つもり/, '〜つもり', 'intend to, plan to', 'いく つもりだ = I plan to go'],
    ['ja-hazu', 'PLAIN', /^ ?はず/, '〜はず', 'should (be), is expected to', 'くる はずだ = should come'],
    ['ja-mae-ni', 'PLAIN', /^ ?(?:まえに|前に)/, '〜まえに', 'before doing', 'ねる まえに = before sleeping'],
    ['ja-ato-de', 'PLAIN', /^ ?(?:あとで|後で|あとに|後に)/, '〜たあとで', 'after doing', 'たべた あとで = after eating'],
    ['ja-tame-ni', 'PLAIN', /^ ?ため(?:に|の)/, '〜ために', 'in order to', 'かつ ために = in order to win'],
    ['ja-hou-ga-ii', 'PLAIN', /^ ?(?:ほう|方)が ?(?:いい|よい|よかった)/, '〜たほうがいい', 'you’d better, it’s best to', 'やすんだ ほうが いい = you’d better rest'],
    ['ja-kamoshirenai', 'PLAIN', /^ ?かも(?:しれ|知れ)?/, '〜かもしれない', 'maybe, might', 'くる かもしれない = might come'],
    ['ja-to-omou', 'PLAIN', /^と ?(?:おも|思)/, '〜とおもう', 'I think (that) / I’m thinking of', 'いこうと おもう = I’m thinking of going']
  ];

  // Gen 5 puts a full-width space (U+3000) between phrases, Gen 4 a normal one: accept both.
  P.forEach(function (p) { p[2] = new RegExp(p[2].source.replace(/ \?/g, '[ \u3000]?')); });

  var ENDINGS = [
    ['なさい', 'command (often a parent to a child): “do …!”'], ['のよ', 'explaining, soft: “…, you see”'], ['のだ', 'explaining: “it’s that …”'],
    ['んだ', 'explaining: “it’s that …”'], ['んです', 'explaining, polite'], ['でしょう', '“probably / …, right?”'], ['だろう', '“probably / …, right?”'],
    ['かな', '“I wonder …”'], ['ましょう', '“let’s …”'], ['ください', 'please'], ['よね', '“…, right?”'], ['ぞ', 'emphatic (rough): “…!”'],
    ['ぜ', 'emphatic (rough, friendly): “…!”'], ['わ', 'soft emphasis'], ['よ', 'telling you: “…, you know”'], ['ね', 'looking for agreement: “…, right?”'],
    ['ば', 'if'], ['たら', 'if, when'], ['から', 'because'], ['けど', 'but, though'], ['のに', 'even though']
  ];

  function senses(g) {
    var all = String(g || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    return all.slice(0, 2).join('; ');
  }
  // The verb a word is a form of: first dictionary hit that is a verb ("to …").
  function verbOf(dict, tok) {
    if (!dict || !L) return null;
    var r = L.lookup(dict, tok, 4);
    if (r.matched !== L.clean(tok)) return null;
    var vs = r.hits.filter(function (h) { return /^to /i.test(h.gloss); });
    if (!vs.length) return null;
    // Kana can be two verbs (まって: 舞う "dance" or 待つ "wait") with no way to tell: show both when equally common.
    vs[0].alt = vs[1] && vs[1].rank - vs[0].rank <= 5 ? vs[1] : null;
    return vs[0];
  }
  function formOf(tok, hit) {
    if (/(?:なければ|なきゃ|なくては|なくちゃ|ないと)$/.test(tok)) return 'MUST';
    if (/ないで$/.test(tok)) return 'NAIDE';
    if (/[てで]$/.test(tok) && /te-form/.test(hit.how)) return 'TE';
    if (/^(?:|past|negative|past negative)$/.test(hit.how)) return 'PLAIN';
    return '';
  }

  // tokens: KRLookupJa.segment(dict, line) words, so a pattern starts on a word boundary.
  function find(dict, line) {
    if (!L) return [];
    var parts = L.segment(dict, line), pos = 0, toks = [];
    parts.forEach(function (p) { if (p.w) toks.push({ t: p.t, s: pos, e: pos + p.t.length }); pos += p.t.length; });
    var hits = [];
    for (var i = 0; i < toks.length; i++) {
      // A verb can be split by the segmenter (いかな|ければ): try one and two tokens.
      for (var span = 2; span >= 1; span--) {
        if (i + span > toks.length) continue;
        var a = toks[i], b = toks[i + span - 1];
        if (span === 2 && a.e !== b.s) continue;
        var w = line.slice(a.s, b.e), hit = verbOf(dict, w);
        if (!hit) continue;
        var form = formOf(w, hit), rest = line.slice(b.e), found = null;
        for (var k = 0; k < P.length && !found; k++) {
          var m = P[k][1] === form && P[k][2].exec(rest);
          if (m) found = { p: P[k], len: m[0].length };
        }
        if (!found) continue;
        var end = b.e + found.len;
        for (var j = 0; j < toks.length; j++) if (toks[j].s < end && toks[j].e > end) end = toks[j].e;   // end on a word
        hits.push({ start: a.s, end: end, verb: hit.word, verbGloss: senses(hit.gloss), alt: hit.alt,
          pattern: { id: found.p[0], label: found.p[3], en: found.p[4], ex: found.p[5] } });
        break;
      }
    }
    var out = [];
    hits.forEach(function (h) {
      var o = out[out.length - 1];
      if (o && h.start < o.end) {
        o.end = Math.max(o.end, h.end);
        if (!o.patterns.some(function (x) { return x.id === h.pattern.id; })) o.patterns.push(h.pattern);
      } else out.push({ start: h.start, end: h.end, patterns: [h.pattern], verbs: [h.verb].concat(h.alt ? [h.alt.word] : []), glosses: [h.verbGloss].concat(h.alt ? [senses(h.alt.gloss)] : []) });
    });
    out.forEach(function (o) {
      o.text = line.slice(o.start, o.end);
      var ps = Math.max(o.start, line.lastIndexOf(' ', o.end - 1) + 1, line.lastIndexOf('　', o.end - 1) + 1);   // last phrase of the chunk
      o.ending = ending(line.slice(ps));
    });
    return out;
  }
  // The ending of the phrase the chunk is in (up to the next space or punctuation).
  function ending(text) {
    var t = text.split(/[ 　、。！？!?…]/)[0];
    for (var i = 0; i < ENDINGS.length; i++) {
      var e = ENDINGS[i][0];
      if (t.length > e.length && t.slice(-e.length) === e) return { form: '〜' + e, en: ENDINGS[i][1] };
    }
    return null;
  }

  var FILLER = { 'こと': 1, 'よう': 1, 'ため': 1, 'はず': 1, 'つもり': 1 };
  var api = { find: find, ending: ending, patterns: P, FILLER: FILLER,
    byId: function (id) { for (var i = 0; i < P.length; i++) if (P[i][0] === id) return { id: id, label: P[i][3], en: P[i][4], ex: P[i][5] }; return null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KRGrammarJa = api;
})(this);
