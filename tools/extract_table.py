import re, json, sys
src = open(sys.argv[1], encoding='utf-8').read()
consts = {'NUL': None, 'EMP': None, 'HGM': '♂', 'HGF': '♀'}
def parse(name):
    m = re.search(r'Table' + name + r'\s*=>\s*\[(.*?)\];', src, re.S)
    body = re.sub(r'//[^\n]*', '', m.group(1))
    toks = re.findall(r"'(\\u[0-9A-Fa-f]{4}|\\'|\\\\|[^'])'|\b([A-Z]{3})\b", body)
    out = []
    for lit, ident in toks:
        if lit:
            if lit.startswith('\\u'): ch = chr(int(lit[2:], 16))
            elif lit == "\\'": ch = "'"
            elif lit == '\\\\': ch = '\\'
            else: ch = lit
            out.append(ch)
        else:
            out.append(consts[ident])
    return out
intl, kor = parse('INT'), parse('KOR')
print(len(intl), len(kor), file=sys.stderr)
# Build one map: code -> char (only non-null)
table = {}
for i, c in enumerate(intl):
    if c: table[i] = c
for i, c in enumerate(kor):
    if c: table[0x400 + i] = c
json.dump(table, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(len(table), 'entries;', table.get(0x401), table.get(0x1AC), table.get(0x121), table.get(0x1DE), file=sys.stderr)
