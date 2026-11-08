import csv, json, re, sys, os
R = os.path.expanduser('~/ref/PKHeX/PKHeX.Core/Resources/text')
out = {}
def add(word, gloss, front=False):
    word = word.strip(); gloss = gloss.strip()
    if not word or not gloss or not re.search('[가-힣]', word): return
    lst = out.setdefault(word, [])
    if gloss.lower() in (g.lower() for g in lst): return
    lst.insert(0, gloss) if front else lst.append(gloss)

def pair(ko, en, tag):
    k = open(ko, encoding='utf-8-sig').read().splitlines()
    e = open(en, encoding='utf-8-sig').read().splitlines()
    n = 0
    for a, b in zip(k, e):
        if a.strip() and b.strip():
            add(a, f'{b} ({tag})', front=True); n += 1
    return n
counts = {}
for name, tag in [('Species','Pokémon'),('Moves','move'),('Abilities','ability'),('Types','type'),('Natures','nature')]:
    counts[name] = pair(f'{R}/other/ko/text_{name}_ko.txt', f'{R}/other/en/text_{name}_en.txt', tag)
counts['Items'] = pair(f'{R}/items/text_Items_ko.txt', f'{R}/items/text_Items_en.txt', 'item')
for f in ['00000','02000','03000']:
    ko = f'{R}/locations/gen4/text_hgss_{f}_ko.txt'
    if os.path.exists(ko): counts['loc'+f] = pair(ko, ko.replace('_ko.txt','_en.txt'), 'place')
# Extra Pokémon-world terms kengdic lacks
extra = {'포켓몬':'Pokémon','포켓몬스터':'Pokémon (Pocket Monsters)','몬스터볼':'Poké Ball','포켓몬센터':'Pokémon Center',
 '프렌들리숍':'Poké Mart','체육관':'Gym','관장':'Gym Leader','배지':'badge','트레이너':'Trainer','도감':'Pokédex',
 '포켓몬도감':'Pokédex','박사':'Professor; doctor','라이벌':'rival','기술':'move; technique','레벨':'level',
 '진화':'evolution','배틀':'battle','승부':'match; battle','사천왕':'Elite Four','챔피언':'Champion','포켓기어':'PokéGear',
 '경험치':'experience points','상태이상':'status condition','기절':'fainting','도로':'road; route','마을':'village; town','시티':'City','성도':'Johto (region)','관동':'Kanto (region)','연구소':'laboratory; research institute','엄마':'mom'}
for k, v in extra.items(): add(k, v, front=True)
# General vocabulary: kengdic
with open(os.path.expanduser('~/ref/kengdic/kengdic.tsv'), encoding='utf-8') as fh:
    for row in csv.DictReader(fh, delimiter='\t'):
        s = (row.get('surface') or '').strip(); g = (row.get('gloss') or '').strip()
        if ' ' in s or len(s) > 12 or not g: continue
        g = re.sub(r'\s+', ' ', g)[:80]
        if len(out.get(s, [])) < 4: add(s, g)
final = {k: '; '.join(v[:4]) for k, v in out.items()}
json.dump(final, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
print(counts, len(final), 'entries', os.path.getsize(sys.argv[1])//1024, 'KB')
for w in ['피카츄','치코리타','몬스터볼','성도','박사','체육관','상처약','몸통박치기','가다','친구','공격']:
    print(w, '→', final.get(w))
