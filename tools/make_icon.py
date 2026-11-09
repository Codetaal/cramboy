# Minimal icons: one white glassy symbol on the warm gradient.
import sys; import os; sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from glass import vgrad, rmask
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
S = 1024
TOP, BOT = (255, 214, 92), (247, 150, 38)

def glyph_layer(draw_fn):
    m = Image.new('L', (S, S), 0); draw_fn(ImageDraw.Draw(m)); return m

def finish(mask):
    im = vgrad((S, S), TOP, BOT, 0.25)
    # soft drop shadow
    sh = mask.filter(ImageFilter.GaussianBlur(28)).point(lambda v: int(v * 0.28))
    sh = ImageChops.offset(sh, 0, 22)
    im.paste(Image.new('RGB', (S, S), (150, 70, 0)), (0, 0), sh)
    # white glass fill: pure white at top, very slightly warm at the bottom
    fill = vgrad((S, S), (255, 255, 255), (255, 244, 226))
    im.paste(fill, (0, 0), mask)
    # crisp top-edge highlight inside the shape
    inner = mask.filter(ImageFilter.MinFilter(9))
    edge = ImageChops.subtract(mask, ImageChops.offset(inner, 0, 6))
    im.paste(Image.new('RGB', (S, S), (255, 255, 255)), (0, 0), edge)
    # faint bottom inner shade for depth
    lower = ImageChops.subtract(mask, ImageChops.offset(mask, 0, -10)).point(lambda v: int(v * 0.35))
    im.paste(Image.new('RGB', (S, S), (230, 170, 90)), (0, 0), lower)
    return im

def opt_a():   # two stacked screens, nothing else
    def d(g):
        g.rounded_rectangle((262, 238, 762, 500), radius=58, fill=255)
        g.rounded_rectangle((302, 534, 722, 786), radius=52, fill=255)
    return finish(glyph_layer(d))

def opt_b():   # just 가
    f = ImageFont.truetype(FONT, 520)
    return finish(glyph_layer(lambda g: g.text((512, 500), '가', font=f, fill=255, anchor='mm')))

def opt_c():   # two screens; 가 cut out of the top one
    f = ImageFont.truetype(FONT, 190)
    def d(g):
        g.rounded_rectangle((262, 238, 762, 500), radius=58, fill=255)
        g.rounded_rectangle((302, 534, 722, 786), radius=52, fill=255)
        g.text((512, 362), '가', font=f, fill=0, anchor='mm')
    return finish(glyph_layer(d))

opts = {'A': opt_a(), 'B': opt_b(), 'C': opt_c()}
for k, im in opts.items(): im.save(f'mini-{k}.png')
sheet = Image.new('RGB', (3 * 310 + 30, 430), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
lab = ImageFont.truetype(FONT, 40)
for i, k in enumerate('ABC'):
    x = 20 + i * 310
    for size, (px, py), rad in ((260, (x, 25), 58), (90, (x + 85, 310), 20)):
        ic = opts[k].resize((size, size), Image.LANCZOS)
        sheet.paste(ic, (px, py), rmask((size, size), (0, 0, size - 1, size - 1), rad))
    sd.text((x + 15, 305), k, font=lab, fill=(60, 60, 67))
sheet.save('icon-options.png')
print('ok')
