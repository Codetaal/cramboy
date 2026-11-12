// Japanese word lookup for CheeseLab: turns inflected words back into their dictionary form
// (行きました -> 行く, たべない -> たべる) and finds the longest dictionary word at a tapped position.
// Dictionary format (ja-dict.json): {e: [[word, reading, pos, gloss], ...], f: {form: [entry index, ...]}}
// pos: '1' ichidan verb, '5x' godan verb ending in x, 's' suru verb, 'k' kuru verb, 'i' i-adjective, 'n' other.
(function (root) {
  'use strict';

  // Godan verb endings by column: dictionary ending, i-stem, a-stem, e-stem, o-stem, te-form, ta-form.
  var GODAN = [
    ['う', 'い', 'わ', 'え', 'お', 'って', 'った', '5u'],
    ['く', 'き', 'か', 'け', 'こ', 'いて', 'いた', '5k'],
    ['ぐ', 'ぎ', 'が', 'げ', 'ご', 'いで', 'いだ', '5g'],
    ['す', 'し', 'さ', 'せ', 'そ', 'して', 'した', '5s'],
    ['つ', 'ち', 'た', 'て', 'と', 'って', 'った', '5t'],
    ['ぬ', 'に', 'な', 'ね', 'の', 'んで', 'んだ', '5n'],
    ['ぶ', 'び', 'ば', 'べ', 'ぼ', 'んで', 'んだ', '5b'],
    ['む', 'み', 'ま', 'め', 'も', 'んで', 'んだ', '5m'],
    ['る', 'り', 'ら', 'れ', 'ろ', 'って', 'った', '5r']
  ];
  // Endings that follow the i-stem (ます-stem) / a-stem (negative) of a verb.
  var AFTER_I = [['ます', 'polite'], ['ました', 'polite past'], ['ません', 'polite negative'],
    ['ませんでした', 'polite negative past'], ['ましょう', 'let’s'], ['ましょうか', 'shall we'], ['たい', 'want to'],
    ['たかった', 'wanted to'], ['たくない', 'don’t want to'], ['なさい', 'command'], ['ながら', 'while']];
  var AFTER_A = [['ない', 'negative'], ['なかった', 'past negative'], ['なくて', 'negative te-form'],
    ['なければ', 'must'], ['なきゃ', 'must'], ['ないで', 'without'], ['れる', 'passive'], ['せる', 'causative'], ['ず', 'without']];

  // rules: [surface ending, dictionary ending, required pos ('' = any / intermediate), label]
  var RULES = [];
  function r(from, to, pos, how) { RULES.push([from, to, pos, how]); }
  GODAN.forEach(function (g) {
    var d = g[0], pos = g[7];
    AFTER_I.forEach(function (a) { r(g[1] + a[0], d, pos, a[1]); });
    AFTER_A.forEach(function (a) { r(g[2] + a[0], d, pos, a[1]); });
    r(g[3] + 'ば', d, pos, 'if'); r(g[3] + 'る', d, pos, 'can'); r(g[3] + 'ない', d, pos, 'can’t');
    r(g[3], d, pos, 'command'); r(g[4] + 'う', d, pos, 'let’s'); r(g[4] + 'うか', d, pos, 'shall I');
    r(g[5], d, pos, 'te-form'); r(g[6], d, pos, 'past'); r(g[6] + 'ら', d, pos, 'if/when'); r(g[6] + 'り', d, pos, 'and so on');
  });
  r('って', 'く', '5k', 'te-form'); r('った', 'く', '5k', 'past');          // 行く -> 行って / 行った
  // Ichidan (食べる, 見る): drop る.
  AFTER_I.concat(AFTER_A.filter(function (a) { return a[0] !== 'れる' && a[0] !== 'せる'; })).forEach(function (a) { r(a[0], 'る', '1', a[1]); });
  [['た', 'past'], ['て', 'te-form'], ['たら', 'if/when'], ['れば', 'if'], ['よう', 'let’s'], ['ようか', 'shall I'], ['ろ', 'command'],
   ['られる', 'passive / can'], ['られない', 'can’t'], ['させる', 'causative'], ['れる', 'can']].forEach(function (a) { r(a[0], 'る', '1', a[1]); });
  // する and 来る.
  [['します', 'polite'], ['しました', 'polite past'], ['しません', 'polite negative'], ['ませんでした', ''], ['して', 'te-form'],
   ['した', 'past'], ['しない', 'negative'], ['しなかった', 'past negative'], ['しよう', 'let’s'], ['しましょう', 'let’s'],
   ['すれば', 'if'], ['したら', 'if/when'], ['される', 'passive'], ['させる', 'causative'], ['できる', 'can'], ['しろ', 'command'],
   ['したい', 'want to'], ['しなければ', 'must'], ['せず', 'without']].forEach(function (a) { r(a[0], 'する', 's', a[1]); });
  [['きます', 'polite'], ['きました', 'polite past'], ['きません', 'polite negative'], ['きて', 'te-form'], ['きた', 'past'],
   ['こない', 'negative'], ['こなかった', 'past negative'], ['こよう', 'let’s'], ['くれば', 'if'], ['きたら', 'if/when'],
   ['こられる', 'can'], ['こい', 'command']].forEach(function (a) { r(a[0], 'くる', 'k', a[1]); });
  [['来ます', 'polite'], ['来ました', 'polite past'], ['来て', 'te-form'], ['来た', 'past'], ['来ない', 'negative'],
   ['来なかった', 'past negative']].forEach(function (a) { r(a[0], '来る', 'k', a[1]); });
  // i-adjectives (大きい).
  [['く', 'adverb'], ['くて', 'te-form'], ['かった', 'past'], ['くない', 'negative'], ['くなかった', 'past negative'],
   ['ければ', 'if'], ['かったら', 'if/when'], ['さ', 'noun'], ['そう', 'looks'], ['すぎる', 'too']].forEach(function (a) { r(a[0], 'い', 'i', a[1]); });
  // Helpers after the te-form or the plain form: these end in a form handled above.
  [['ている', 'て', 'progressive'], ['ています', 'て', 'progressive'], ['ていた', 'て', 'was …ing'], ['ていました', 'て', 'was …ing'],
   ['てる', 'て', 'progressive'], ['てた', 'て', 'was …ing'], ['ていない', 'て', 'not …ing'], ['ていません', 'て', 'not …ing'],
   ['でいる', 'で', 'progressive'], ['でいます', 'で', 'progressive'], ['でいた', 'で', 'was …ing'], ['でる', 'で', 'progressive'],
   ['てください', 'て', 'please'], ['でください', 'で', 'please'], ['てくれ', 'て', 'do for me'], ['てあげる', 'て', 'do for someone'],
   ['てしまう', 'て', 'completely'], ['てしまった', 'て', 'completely'], ['ちゃう', 'て', 'completely'], ['ちゃった', 'て', 'completely'],
   ['じゃう', 'で', 'completely'], ['じゃった', 'で', 'completely'], ['ておく', 'て', 'in advance'], ['ておいて', 'て', 'in advance'],
   ['てみる', 'て', 'try'], ['てみて', 'て', 'try'], ['てみた', 'て', 'tried'], ['てきた', 'て', 'came to'], ['ていく', 'て', 'go on']
  ].forEach(function (a) { r(a[0], a[1], '', a[2]); });
  // Longest endings first, and grouped by last character so only rules that can match are tried.
  RULES.sort(function (a, b) { return b[0].length - a[0].length; });
  var BY_LAST = {};
  RULES.forEach(function (rule) { var c = rule[0].slice(-1); (BY_LAST[c] = BY_LAST[c] || []).push(rule); });

  // All possible dictionary forms of a written word: [{form, pos, how}] (the word itself first).
  function deinflect(word) {
    var out = [{ form: word, pos: '', how: '' }], seen = {};
    seen[word + '|'] = 1;
    for (var i = 0; i < out.length && i < 200; i++) {
      var w = out[i];
      if (w.depth >= 3) continue;
      var rules = BY_LAST[w.form.slice(-1)] || [];
      for (var k = 0; k < rules.length; k++) {
        var rule = rules[k], from = rule[0];
        if (w.form.length <= from.length - (rule[1] === 'する' || rule[1] === 'くる' || rule[1] === '来る' ? 1 : 0) ||
            w.form.slice(-from.length) !== from) continue;
        // A word that came out of a rule needing a specific type can only be inflected further as that type.
        if (w.pos && rule[2] && w.pos !== rule[2]) continue;
        var f = w.form.slice(0, -from.length) + rule[1];
        if (!f) continue;
        var key = f + '|' + rule[2];
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ form: f, pos: rule[2] || w.pos, how: rule[3] ? (w.how ? rule[3] + ' · ' + w.how : rule[3]) : w.how, depth: (w.depth || 0) + 1 });
      }
    }
    return out;
  }

  function posOk(need, has) {
    if (!need) return true;
    if (need === 's') return has === 's' || has === 'n';     // noun + する
    return has === need;
  }

  // Longest dictionary word at the start of text. Returns {matched, hits: [{word, reading, gloss, how}]},
  // most common words first (entry rank), Pokémon names and game terms on top.
  function lookup(dict, text, max) {
    max = max || 4;
    text = clean(text);
    for (var n = Math.min(text.length, 14); n >= 1; n--) {
      var s = text.slice(0, n), hits = [], used = {};
      deinflect(s).forEach(function (c) {
        var ids = dict.f[c.form];
        if (!ids) return;
        ids.forEach(function (id) {
          var e = dict.e[id];
          if (used[id] || !posOk(c.pos, e[2])) return;
          used[id] = 1;
          hits.push({ word: e[0], reading: e[1] !== e[0] ? e[1] : '', gloss: e[3], how: c.how, rank: e[4] || 0 });
        });
      });
      if (hits.length) {
        hits.sort(function (a, b) { return a.rank - b.rank; });
        return { matched: s, hits: hits.slice(0, max) };
      }
    }
    return { matched: text.slice(0, 1), hits: [] };
  }

  function clean(s) {
    return String(s).replace(/[​·・…、。！？!?「」『』（）()〜~\s]/g, '');
  }
  function isJa(s) { return /[ぁ-ヿ一-鿿々]/.test(s); }

  // Split a line of Japanese into tappable words, using the dictionary (longest match first).
  // Returns [{t: text, w: true/false}]. Pokémon text already has spaces between phrases; this splits
  // each phrase further (ポケモンの -> ポケモン | の). Results are cached: subtitles grow letter by letter.
  var segCache = new Map();
  function segment(dict, line) {
    var parts = [], re = /[\u3041-\u30FF\u4E00-\u9FFF\u3005]+|[^\u3041-\u30FF\u4E00-\u9FFF\u3005]+/g, m;
    while ((m = re.exec(line))) {
      var run = m[0];
      if (!isJa(run)) { parts.push({ t: run, w: false }); continue; }
      if (!dict) { parts.push({ t: run, w: true }); continue; }
      var cached = segCache.get(run);
      if (!cached) {
        cached = [];
        for (var i = 0; i < run.length;) {
          var r = lookup(dict, run.slice(i), 1), n = r.hits.length ? r.matched.length : 1;
          cached.push(run.slice(i, i + n)); i += n;
        }
        if (segCache.size > 2000) segCache.clear();
        segCache.set(run, cached);
      }
      cached.forEach(function (t) { parts.push({ t: t, w: true }); });
    }
    return parts;
  }

  var api = { deinflect: deinflect, lookup: lookup, segment: segment, clean: clean, isJa: isJa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KRLookupJa = api;
})(this);
