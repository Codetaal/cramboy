# Round "DS" marker variants on the blue CheeseLab flask: positions, edge styles and lettering.
import sys, math; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open('./family.py').read().split("FAMILY = [")[0])
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
BLUE_T, BLUE_B = (128, 182, 236), (58, 98, 186)
GOLD, GOLD_HI, GOLD_RIM, INK, NAVY = (255, 214, 92), (255, 236, 160), (214, 140, 30), (92, 44, 0), (30, 50, 110)
G = 20
FONTS = {   # original pixel alphabets, letters D and S
    'chunky':  {'D': ["###.", "#..#", "#..#", "#..#", "###."], 'S': [".###", "#...", ".##.", "...#", "###."]},
    'bold':    {'D': ["####.", "##.##", "##.##", "##.##", "##.##", "##.##", "####."],
                'S': [".####", "##...", "##...", ".###.", "...##", "...##", "####."]},
    'rounded': {'D': ["##..", "#.#.", "#..#", "#..#", "#.#.", "##.."], 'S': [".##.", "#..#", ".#..", "..#.", "#..#", ".##."]},
    'tall':    {'D': ["##.", "#.#", "#.#", "#.#", "#.#", "#.#", "##."], 'S': [".##", "#..", "#..", ".#.", "..#", "..#", "##."]},
}
def glyph_cells(font, txt='DS', gap=1):
    cells = set(); x = 0; F = FONTS[font]
    for c in txt:
        for dy, row in enumerate(F[c]):
            for dx, ch in enumerate(row):
                if ch == '#': cells.add((x + dx, dy))
        x += len(F[c][0]) + gap
    return cells, x - gap, len(F['D'])

def badge(im, cx, cy, r, edge='coin', font='chunky', outlined=False, smooth=False):
    d = ImageDraw.Draw(im)
    def cell(x, y, col): d.rectangle((x * G, y * G, (x + 1) * G - 1, (y + 1) * G - 1), fill=col)
    disc = lambda rr: {(x, y) for x in range(52) for y in range(52) if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr}
    outer = disc(r + (1.2 if edge == 'sticker' else 0))
    for x, y in outer: cell(x + 1, y + 1, NAVY)                    # hard shadow
    if edge == 'sticker':
        for x, y in outer: cell(x, y, (255, 255, 250))               # white vinyl border
    inner = disc(r)
    for x, y in inner: cell(x, y, GOLD)
    if edge == 'rim':
        for x, y in inner - disc(r - 1.2): cell(x, y, GOLD_RIM)
    for x, y in inner:
        if (x, y - 1) not in inner and edge != 'rim': cell(x, y, GOLD_HI)
    if smooth:
        f = ImageFont.truetype(FONT, int(r * G * 0.95))
        d.text(((cx) * G, (cy) * G + r * G * 0.04), 'DS', font=f, fill=INK, anchor='mm')
        return im
    t, tw, th = glyph_cells(font)
    ox = round(cx - tw / 2); oy = round(cy - th / 2)
    if outlined:
        for x, y in t:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1): cell(ox + x + dx, oy + y + dy, INK)
        for x, y in t: cell(ox + x, oy + y, (255, 255, 250))
    else:
        for x, y in t: cell(ox + x, oy + y, INK)
    return im

V = [
    ('1  Coin · chunky', dict(cx=40, cy=41, r=7.6)),
    ('2  Rim · bold', dict(cx=40, cy=40, r=8.6, edge='rim', font='bold')),
    ('3  Sticker · rounded', dict(cx=40, cy=40, r=7.6, edge='sticker', font='rounded')),
    ('4  Top corner · tall', dict(cx=40.5, cy=10.5, r=7.2, font='tall')),
    ('5  Coin · smooth', dict(cx=40, cy=41, r=7.6, smooth=True)),
    ('6  Sticker · outlined', dict(cx=40.5, cy=10.5, r=7.6, edge='sticker', font='chunky', outlined=True)),
]
lab = ImageFont.truetype(FONT, 22)
sheet = Image.new('RGB', (3 * 300 + 40, 2 * 330 + 20), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
for i, (name, kw) in enumerate(V):
    im = icon(BLUE_T, BLUE_B, CHEESE)
    if kw.get('cy', 40) < 20:   # top-corner variants: drop the sparkle that sits there
        d = ImageDraw.Draw(im); ox = (S - 20 * 40) // 2; oy = (S - 20 * 40) // 2 + 10
        top = mix(BLUE_T, BLUE_B, 0)  # repaint later by re-rendering sky cell colours is overkill; badge covers it
    badge(im, **kw); im.save(f'./badge2-{i + 1}.png')
    col, row = i % 3, i // 3; x = 20 + col * 300; y = 15 + row * 330
    t = im.resize((200, 200), Image.LANCZOS); sheet.paste(t, (x, y), rmask((200, 200), (0, 0, 199, 199), 45))
    s = im.resize((70, 70), Image.LANCZOS); sheet.paste(s, (x + 210, y + 130), rmask((70, 70), (0, 0, 69, 69), 16))
    sd.text((x, y + 215), name, font=lab, fill=(50, 50, 56))
sheet.save('icon-preview.png'); print('ok')
