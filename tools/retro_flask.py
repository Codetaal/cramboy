# Retro pixel-art versions of the CheeseLab flask (option A).
import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from glass import vgrad, rmask
S = 1024
TOP, BOT = (255, 214, 92), (247, 150, 38)
# Symmetric flask: half-width per row around the centre of a 20-column grid; None = liquid-surface gap
HALF = [0, 4, 4, 2, 2, 2, 2, 3, 4, None, 5, 5, 6, 6, 7, 7, 8, 8, 9, 0]
HOLES = {(6, 12), (7, 12), (6, 13), (7, 13),                                # 2x2
         (12, 13), (13, 13), (11, 14), (12, 14), (13, 14), (14, 14),        # round 4x4 (corners kept)
         (11, 15), (12, 15), (13, 15), (14, 15), (12, 16), (13, 16),
         (5, 16), (6, 16), (5, 17), (6, 17),                                # 2x2
         (14, 17), (9, 10)}                                                 # tiny bubbles
rows = []
for y, w in enumerate(HALF):
    r = ['.'] * 20
    if w:
        for x in range(10 - w, 10 + w):
            if (x, y) not in HOLES: r[x] = '#'
    rows.append(''.join(r))
W, H = len(rows[0]), len(rows)

def cells():
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '#': yield x, y

def outline_cells(fill):
    out = set()
    for x, y in fill:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                p = (x + dx, y + dy)
                if p not in fill: out.add(p)
    return out

def render(bg='smooth', outline=None, shadow=(196, 98, 10), sparkle=False, scan=False):
    cs = 40; ox = (S - W * cs) // 2; oy = (S - H * cs) // 2 + 10
    if bg == 'smooth':
        im = vgrad((S, S), TOP, BOT, 0.0)
    else:  # banded retro gradient
        im = Image.new('RGB', (S, S)); d0 = ImageDraw.Draw(im)
        bands = 6
        for i in range(bands):
            t = i / (bands - 1)
            col = tuple(int(TOP[k] + (BOT[k] - TOP[k]) * t) for k in range(3))
            d0.rectangle((0, i * S // bands, S, (i + 1) * S // bands), fill=col)
    d = ImageDraw.Draw(im)
    fill = set(cells())
    def px(x, y, col):
        d.rectangle((ox + x * cs, oy + y * cs, ox + (x + 1) * cs - 1, oy + (y + 1) * cs - 1), fill=col)
    if shadow:
        for x, y in (outline_cells(fill) | fill) if outline else fill:
            px(x + 1, y + 1, shadow)
    if outline:
        for x, y in outline_cells(fill): px(x, y, outline)
    for x, y in fill: px(x, y, (255, 252, 240))
    # pixel highlight: a lighter column on the left of the neck and body
    for x, y in fill:
        if (x - 1, y) not in fill and 2 <= y <= 18: px(x, y, (255, 255, 255))
    if sparkle:
        for (sx, sy) in ((16, 3), (3, 6)):
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                px(sx + dx, sy + dy, (255, 255, 255))
    if scan:
        sd = ImageDraw.Draw(im, 'RGBA')
        for y in range(0, S, 8): sd.rectangle((0, y, S, y + 2), fill=(0, 0, 0, 18))
    return im

opts = {
    'A': render(),                                                     # clean pixel sprite + hard shadow
    'B': render(outline=(92, 44, 0), shadow=None, sparkle=True),       # outlined sprite with sparkles
    'C': render(bg='bands', outline=(92, 44, 0), shadow=(196, 98, 10), scan=True),  # banded sky + scanlines
}
for k, im in opts.items(): im.save(f'retro-{k}.png')
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
sheet = Image.new('RGB', (3 * 310 + 30, 430), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
lab = ImageFont.truetype(FONT, 40)
for i, k in enumerate('ABC'):
    x = 20 + i * 310
    for size, (px_, py), rad in ((260, (x, 25), 58), (90, (x + 85, 310), 20)):
        ic = opts[k].resize((size, size), Image.LANCZOS)
        sheet.paste(ic, (px_, py), rmask((size, size), (0, 0, size - 1, size - 1), rad))
    sd.text((x + 15, 305), k, font=lab, fill=(60, 60, 67))
sheet.save('icon-options.png')
print('ok')
