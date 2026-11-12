"""Builds docs/kr/ja-dict.json: a compact Japanese -> English dictionary for CheeseLab.

Sources:
  * JMdict (English), (c) the Electronic Dictionary Research and Development Group, CC BY-SA 4.0
    https://www.edrdg.org/jmdict/j_jmdict.html  (download JMdict_e.gz to ~/ref/jmdict/)
  * Pokémon names (species, moves, items, abilities, types, natures, places) from PKHeX (GPL-3.0),
    ~/ref/PKHeX/PKHeX.Core/Resources/text

Output: {"e": [[word, reading, pos, gloss, rank], ...], "f": {"form": [entry index, ...]}} where form is any
written form (kanji or kana); entries are sorted most common first.
pos is one of '1' (ichidan verb), '5x' (godan verb ending in x), 's' (suru verb), 'k' (kuru),
'i' (i-adjective), 'n' (other). prio: lower = more common.
"""
import gzip, json, os, re, sys
import xml.etree.ElementTree as ET

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/kr/ja-dict.json'
MODE = sys.argv[2] if len(sys.argv) > 2 else 'common'
JM = os.path.expanduser('~/ref/jmdict/JMdict_e.gz')
R = os.path.expanduser('~/ref/PKHeX/PKHeX.Core/Resources/text')

# JMdict uses XML entities for POS (&v5k; ...). Keep the entity names instead of expanding them.
raw = gzip.open(JM, 'rt', encoding='utf-8').read()
raw = re.sub(r'<!DOCTYPE JMdict \[.*?\]>', '', raw, flags=re.S)
raw = re.sub(r'&([\w-]+);', r'\1', raw)
root = ET.fromstring(raw)

def pos_code(tags):
    for t in tags:
        if t == 'v1' or t.startswith('v1-'): return '1'
        if t.startswith('v5'):
            m = {'v5u': 'u', 'v5u-s': 'u', 'v5k': 'k', 'v5k-s': 'k', 'v5g': 'g', 'v5s': 's', 'v5t': 't', 'v5n': 'n',
                 'v5b': 'b', 'v5m': 'm', 'v5r': 'r', 'v5r-i': 'r', 'v5aru': 'r'}
            if t in m: return '5' + m[t]
        if t in ('vs-i', 'vs-s', 'vs'): return 's'
        if t == 'vk': return 'k'
        if t in ('adj-i', 'adj-ix'): return 'i'
    return 'n'

PRI = {'news1': 1, 'ichi1': 1, 'spec1': 1, 'gai1': 1, 'news2': 2, 'ichi2': 2, 'spec2': 2, 'gai2': 2}
out, entries = {}, 0
def add(form, item):
    lst = out.setdefault(form, [])
    if any(x[0] == item[0] and x[1] == item[1] for x in lst): return
    lst.append(item)

for e in root.iter('entry'):
    kebs = [k.findtext('keb') for k in e.findall('k_ele')]
    rebs = [r.findtext('reb') for r in e.findall('r_ele')]
    pri, nf = 9, 99                    # priority bucket (1 = most common) and frequency band nf01..nf48
    for el in e.iter():
        if el.tag in ('ke_pri', 're_pri'):
            t = el.text or ''
            if t in PRI: pri = min(pri, PRI[t])
            elif t.startswith('nf'): nf = min(nf, int(t[2:]))
    senses = e.findall('sense')
    tags = [p.text for s in senses for p in s.findall('pos')]
    usually_kana = any(m.text == 'uk' for m in senses[0].findall('misc'))   # first sense written in kana
    glosses = []
    for s in senses[:3]:
        g = [x.text for x in s.findall('gloss') if x.text][:3]
        if g: glosses.append(', '.join(g))
    # Up to ~90 characters, cut at a meaning boundary (never mid-word).
    gloss = ''
    for g in glosses:
        nxt = (gloss + '; ' if gloss else '') + g
        if len(nxt) <= 90: gloss = nxt; continue
        if not gloss:
            parts = g.split(', '); gloss = parts[0]
            for q in parts[1:]:
                if len(gloss) + 2 + len(q) > 90: break
                gloss += ', ' + q
        break
    if not gloss: continue
    if MODE == 'common' and pri >= 9:
        continue                      # only words JMdict marks as common; the rest is left to Jisho
    entries += 1
    head = kebs[0] if kebs and not usually_kana else rebs[0]
    item = [head, rebs[0], pos_code(tags), gloss, pri * 100 + nf]
    for k in kebs: add(k, item)
    for r in rebs: add(r, item)

def pair(ja, en, tag):
    if not os.path.exists(ja): return 0
    j = open(ja, encoding='utf-8-sig').read().splitlines()
    n = 0
    for a, b in zip(j, open(en, encoding='utf-8-sig').read().splitlines()):
        a, b = a.strip(), b.strip()
        if a and b and a != b and re.search('[぀-ヿ一-鿿]', a):
            lst = out.setdefault(a, [])
            lst.insert(0, [a, a, 'n', f'{b} ({tag})', -1]); n += 1
    return n
counts = {}
for name, tag in [('Species', 'Pokémon'), ('Moves', 'move'), ('Abilities', 'ability'), ('Types', 'type'), ('Natures', 'nature')]:
    counts[name] = pair(f'{R}/other/ja/text_{name}_ja.txt', f'{R}/other/en/text_{name}_en.txt', tag)
counts['Items'] = pair(f'{R}/items/text_Items_ja.txt', f'{R}/items/text_Items_en.txt', 'item')
for f in ['00000', '02000', '03000']:
    counts['hgss' + f] = pair(f'{R}/locations/gen4/text_hgss_{f}_ja.txt', f'{R}/locations/gen4/text_hgss_{f}_en.txt', 'place')
for f in ['00000', '30000', '40000', '60000']:
    counts['bw2' + f] = pair(f'{R}/locations/gen5/text_bw2_{f}_ja.txt', f'{R}/locations/gen5/text_bw2_{f}_en.txt', 'place')
extra = {'ポケモン': 'Pokémon', 'ポケットモンスター': 'Pokémon (Pocket Monsters)', 'モンスターボール': 'Poké Ball',
         'ポケモンセンター': 'Pokémon Center', 'フレンドリィショップ': 'Poké Mart', 'ジム': 'Gym', 'ジムリーダー': 'Gym Leader',
         'バッジ': 'badge', 'トレーナー': 'Trainer', 'ずかん': 'Pokédex; picture book', 'ポケモンずかん': 'Pokédex',
         'はかせ': 'Professor; doctor', 'わざ': 'move; technique', 'レベル': 'level', 'しんか': 'evolution',
         'してんのう': 'Elite Four', 'チャンピオン': 'Champion', 'ポケギア': 'PokéGear', 'けいけんち': 'experience points',
         'ジョウト': 'Johto (region)', 'カントー': 'Kanto (region)', 'イッシュ': 'Unova (region)', 'けんきゅうじょ': 'laboratory'}
for k, v in extra.items():
    out.setdefault(k, []).insert(0, [k, k, 'n', v, -1])

# Store each entry once; forms point to entries. Most common first, at most 10 entries per form
# (kana forms have many homophones, e.g. かく: 書く, 角, 各…). Entries keep a rank: lower = more common.
items, index, forms = [], {}, {}
for form, lst in out.items():
    ids = []
    for it in sorted(lst, key=lambda x: x[4])[:10]:
        key = (it[0], it[1], it[3])
        if key not in index: index[key] = len(items); items.append(it[:4] + [max(0, it[4])])
        if index[key] not in ids: ids.append(index[key])
    forms[form] = ids
json.dump({'e': items, 'f': forms}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
final = {k: [items[i] for i in v] for k, v in forms.items()}
print(MODE, entries, 'entries,', len(final), 'forms,', os.path.getsize(OUT) // 1024, 'KB;', counts)
for w in ['ピカチュウ', 'チコリータ', 'いく', '行く', 'みる', 'はかせ', 'せかい', 'ようこそ', 'たべる', 'きずぐすり', 'たいあたり', 'ポケモン']:
    print(w, '→', final.get(w, [])[:2])
