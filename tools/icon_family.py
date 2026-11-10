# CheeseLab icon family: same flask, sparkles and stepped sky; per tool a cheese colour + emblem in the liquid.
import math
from PIL import Image, ImageDraw, ImageFont
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glass import rmask
S = 1024; cs = 40; GW = 20
HALF = [0, 4, 4, 2, 2, 2, 2, 3, 4, None, 5, 5, 6, 6, 7, 7, 8, 8, 9, 0]
CHEESE = {(6, 12), (7, 12), (6, 13), (7, 13), (12, 13), (13, 13), (11, 14), (12, 14), (13, 14), (14, 14),
          (11, 15), (12, 15), (13, 15), (14, 15), (12, 16), (13, 16), (5, 16), (6, 16), (5, 17), (6, 17), (14, 17), (9, 10)}
def rect(x0, y0, x1, y1): return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
SCREENS = rect(7, 11, 12, 13) | rect(7, 15, 12, 17)                          # two stacked screens
PAD = rect(5, 14, 7, 14) | rect(6, 13, 6, 15) | {(12, 13), (14, 13), (13, 15), (11, 15)} | rect(8, 17, 11, 17)   # d-pad + buttons
CART = (rect(7, 11, 12, 17) - rect(8, 12, 11, 14)) - {(7, 11), (12, 11)}    # cartridge outline with label window
CART = {(x, y) for (x, y) in rect(7, 11, 12, 17)} - (rect(8, 12, 11, 13))    # solid cart, label window stays filled
def flask(holes):
    return {(x, y) for y, w in enumerate(HALF) if w for x in range(10 - w, 10 + w) if (x, y) not in holes}
def mix(a, b, t): return tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))
def icon(top, bot, holes):
    ox = (S - GW * cs) // 2; oy = (S - 20 * cs) // 2 + 10; G = cs // 2
    im = Image.new('RGB', (S, S)); d = ImageDraw.Draw(im)
    x0 = ox % G - G; y0 = oy % G - G; n = S // G + 2
    for gy in range(n):
        t = min(0.999, max(0, gy / n)); step = math.floor(t * 8) / 7
        d.rectangle((0, y0 + gy * G, S, y0 + (gy + 1) * G - 1), fill=mix(top, bot, step))
    shadow = mix(bot, (60, 20, 0), 0.35)
    fill = flask(holes)
    def px(x, y, col): d.rectangle((ox + x * cs, oy + y * cs, ox + (x + 1) * cs - 1, oy + (y + 1) * cs - 1), fill=col)
    for x, y in fill: px(x + 1, y + 1, shadow)
    for x, y in fill: px(x, y, (255, 252, 240))
    for x, y in fill:
        if (x - 1, y) not in fill and 2 <= y <= 18: px(x, y, (255, 255, 255))
    for (sx, sy) in ((2, 3), (17, 2), (16, 8), (3, 11)):
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            d.rectangle((ox + (sx * 2 + dx) * G, oy + (sy * 2 + dy) * G, ox + (sx * 2 + dx + 1) * G - 1, oy + (sy * 2 + dy + 1) * G - 1), fill=(255, 250, 225))
    return im
FAMILY = [
    ('CheeseLab', 'Gouda gold · cheese holes', (255, 214, 92), (247, 150, 38), CHEESE),
    ('CheeseLab DS', 'Cheddar orange · two screens', (255, 158, 72), (222, 82, 34), SCREENS),
    ('Next tool', 'Blue cheese · gamepad', (128, 182, 236), (58, 98, 186), PAD),
    ('Another tool', 'Pesto green · cartridge', (160, 214, 112), (66, 146, 72), CART),
]
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
f1 = ImageFont.truetype(FONT, 26); f2 = ImageFont.truetype(FONT, 19)
sheet = Image.new('RGB', (4 * 260 + 40, 400), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
for i, (name, sub, top, bot, holes) in enumerate(FAMILY):
    im = icon(top, bot, holes); im.save(f'./family-{i}.png')
    x = 30 + i * 260
    t = im.resize((200, 200), Image.LANCZOS); sheet.paste(t, (x, 30), rmask((200, 200), (0, 0, 199, 199), 45))
    s = im.resize((70, 70), Image.LANCZOS); sheet.paste(s, (x + 65, 245), rmask((70, 70), (0, 0, 69, 69), 16))
    sd.text((x + 100, 335), name, font=f1, fill=(30, 30, 35), anchor='mm')
    sd.text((x + 100, 368), sub, font=f2, fill=(110, 110, 118), anchor='mm')
sheet.save('icon-preview.png'); print('ok')
