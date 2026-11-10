# Minimal iOS 27-style (sharper Liquid Glass) icons for CheeseLab DS.
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
S = 1024

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
def vgrad(size, top, bot, angle_mix=0.0):
    w, h = size; im = Image.new('RGB', size); px = im.load()
    for y in range(h):
        for x in range(0, w):
            t = (y / h) * (1 - angle_mix) + (x / w) * angle_mix
            px[x, y] = lerp(top, bot, t)
    return im
def rmask(size, box, r):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).rounded_rectangle(box, radius=r, fill=255); return m

def glass(base, box, r, tint=(255, 255, 255), alpha=0.22, shadow=0.35):
    W, H = base.size
    m = rmask(base.size, box, r)
    # soft shadow below the pane
    sh = Image.new('L', base.size, 0); x0, y0, x1, y1 = box
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 18, x1, y1 + 18), radius=r, fill=int(255 * shadow))
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    base.paste(Image.new('RGB', base.size, (0, 0, 0)), (0, 0), sh)
    # refraction: slightly blurred, brightened copy of what's behind
    behind = base.filter(ImageFilter.GaussianBlur(10))
    body = Image.blend(behind, Image.new('RGB', base.size, tint), alpha)
    # vertical sheen: lighter at the top
    sheen = vgrad(base.size, (255, 255, 255), (255, 255, 255))
    sm = Image.new('L', base.size, 0); d = ImageDraw.Draw(sm)
    for y in range(y0, y1):
        t = (y - y0) / max(1, (y1 - y0)); d.line([(x0, y), (x1, y)], fill=int(70 * (1 - t) ** 2))
    body.paste(sheen, (0, 0), ImageChops.multiply(sm, m))
    base.paste(body, (0, 0), m)
    # crisp edge: bright top-left rim fading to a faint bottom rim
    rim = Image.new('L', base.size, 0); rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle(box, radius=r, outline=255, width=5)
    fade = Image.new('L', base.size, 0); fd = ImageDraw.Draw(fade)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0)); fd.line([(0, y), (W, y)], fill=int(200 - 150 * t))
    base.paste(Image.new('RGB', base.size, (255, 255, 255)), (0, 0), ImageChops.multiply(rim, fade))

def glyph(base, cx, cy, size, color, glow=None):
    f = ImageFont.truetype(FONT, size)
    if glow:
        g = Image.new('L', base.size, 0); ImageDraw.Draw(g).text((cx, cy), '가', font=f, fill=150, anchor='mm')
        base.paste(Image.new('RGB', base.size, glow), (0, 0), g.filter(ImageFilter.GaussianBlur(22)))
    ImageDraw.Draw(base).text((cx, cy), '가', font=f, fill=color, anchor='mm')

def lines(base, x, y, w, h, color, alpha=255):
    lay = Image.new('L', base.size, 0); d = ImageDraw.Draw(lay)
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=alpha)
    d.rounded_rectangle((x, y + h * 2.1, x + w * 0.62, y + h * 3.1), radius=h // 2, fill=alpha)
    base.paste(Image.new('RGB', base.size, color), (0, 0), lay)

def option(v):
    if v == 'A':   # night gradient, clear glass screens, warm 가
        im = vgrad((S, S), (38, 44, 92), (10, 12, 26), 0.25)
        top, bot = (232, 250, 792, 548), (312, 590, 712, 800)
        glass(im, top, 70, alpha=0.10); glass(im, bot, 56, alpha=0.08)
        glyph(im, 512, 392, 240, (255, 214, 102), glow=(255, 190, 60))
        lines(im, 380, 660, 264, 26, (255, 214, 102), 200)
    elif v == 'B': # warm yellow gradient, white frosted glass, dark 가
        im = vgrad((S, S), (255, 222, 120), (246, 166, 52), 0.3)
        top, bot = (232, 250, 792, 548), (312, 590, 712, 800)
        glass(im, top, 70, alpha=0.38, shadow=0.22); glass(im, bot, 56, alpha=0.30, shadow=0.18)
        glyph(im, 512, 392, 240, (40, 30, 20))
        lines(im, 380, 660, 264, 26, (120, 70, 20), 170)
    else:          # C: one glass pane with a hinge line, ultra minimal
        im = vgrad((S, S), (24, 26, 34), (6, 7, 10), 0.2)
        box = (262, 200, 762, 824)
        glass(im, box, 92, alpha=0.10)
        ImageDraw.Draw(im).line([(300, 512), (724, 512)], fill=(255, 214, 102), width=6)
        glyph(im, 512, 352, 230, (255, 214, 102), glow=(255, 190, 60))
        lines(im, 392, 618, 240, 24, (255, 255, 255), 120)
    return im

if __name__ == '__main__':
    import sys
    opts = {v: option(v) for v in 'ABC'}
    for v, im in opts.items(): im.save(f'glass-{v}.png')
    sheet = Image.new('RGB', (3 * 310 + 30, 430), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
    lab = ImageFont.truetype(FONT, 40)
    for i, v in enumerate('ABC'):
        x = 20 + i * 310
        for size, (px, py), rad in ((260, (x, 25), 58), (90, (x + 85, 310), 20)):
            ic = opts[v].resize((size, size), Image.LANCZOS)
            sheet.paste(ic, (px, py), rmask((size, size), (0, 0, size - 1, size - 1), rad))
        sd.text((x + 15, 305), v, font=lab, fill=(60, 60, 67))
    sheet.save('/tmp/claude-0/-home-claude/98a3ce9f-4b3b-5bc0-a689-3b647516e234/scratchpad/glass-options.png')
    print('ok')
