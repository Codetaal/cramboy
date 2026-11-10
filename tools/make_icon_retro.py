import os
# Sprite A with retro pixel backgrounds, on a grid aligned with the sprite's pixels.
import sys, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import os; exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'retro_flask.py')).read().split("opts = {")[0])
TOP, BOT = (255, 214, 92), (247, 150, 38)
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
DEEP = (232, 120, 24)
def mix(a, b, t): return tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))
cs = 40; ox = (S - W * cs) // 2; oy = (S - H * cs) // 2 + 10
G = cs // 2                                     # background pixel = half a sprite pixel
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

def bg_bands(gx, gy, n):
    t = min(0.999, max(0, gy / n)); step = math.floor(t * 8) / 7
    return mix(TOP, BOT, step)
def bg_dither(gx, gy, n):
    t = gy / n * 3                               # 3 colour zones, dithered between them
    cols = [TOP, mix(TOP, BOT, 0.5), BOT, DEEP]
    i = min(2, int(t)); f = t - i
    return cols[i + 1] if f * 16 > BAYER[gy % 4][gx % 4] + 0.5 else cols[i]
def bg_rays(gx, gy, n):
    cx, cy = n / 2, n * 0.56
    a = math.atan2(gy + 0.5 - cy, gx + 0.5 - cx)
    ray = int((a + math.pi) / (2 * math.pi) * 16) % 2
    base = mix(TOP, BOT, min(1, max(0, gy / n)))
    return mix(base, (255, 236, 150), 0.45) if ray else base

def paint_bg(fn):
    im = Image.new('RGB', (S, S)); d = ImageDraw.Draw(im)
    x0 = ox % G - G; y0 = oy % G - G; n = S // G + 2
    for gy in range(n):
        for gx in range(n):
            d.rectangle((x0 + gx * G, y0 + gy * G, x0 + (gx + 1) * G - 1, y0 + (gy + 1) * G - 1), fill=fn(gx, gy, n))
    return im

def sprite_on(im, sparkles=()):
    d = ImageDraw.Draw(im); fill = set(cells())
    def px(x, y, col): d.rectangle((ox + x * cs, oy + y * cs, ox + (x + 1) * cs - 1, oy + (y + 1) * cs - 1), fill=col)
    for x, y in fill: px(x + 1, y + 1, (196, 98, 10))
    for x, y in fill: px(x, y, (255, 252, 240))
    for x, y in fill:
        if (x - 1, y) not in fill and 2 <= y <= 18: px(x, y, (255, 255, 255))
    for (sx, sy) in sparkles:                     # small 1-pixel-arm stars, in background pixels
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            d.rectangle((ox + (sx * 2 + dx) * G, oy + (sy * 2 + dy) * G, ox + (sx * 2 + dx + 1) * G - 1, oy + (sy * 2 + dy + 1) * G - 1), fill=(255, 250, 225))
    return im

opts = {
    'A': sprite_on(paint_bg(bg_bands), sparkles=((2, 3), (17, 2), (16, 8), (3, 11))),
    'B': sprite_on(paint_bg(bg_dither)),
    'C': sprite_on(paint_bg(bg_rays)),
}
for k, im in opts.items(): im.save(f'retrobg-{k}.png')
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
