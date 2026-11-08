from PIL import Image, ImageDraw, ImageFont
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
S = 2048  # supersampled canvas
Y, DARK, INK, GREY = (255, 214, 102), (14, 16, 24), (38, 42, 53), (120, 126, 142)

def rr(d, box, r, **kw): d.rounded_rectangle([int(v) for v in box], radius=int(r), **kw)
def ga(d, cx, cy, size, fill):
    f = ImageFont.truetype(FONT, int(size)); d.text((cx, cy), '가', font=f, fill=fill, anchor='mm')

def device(d, x0, y0, w, body, screen_top, screen_bot, ga_col, accent):
    # Open clamshell: upper half, hinge, lower half with controls
    h = w * 1.18; half = h / 2 - w * 0.02
    rr(d, (x0, y0, x0 + w, y0 + half), w * 0.09, fill=body)
    rr(d, (x0, y0 + h - half, x0 + w, y0 + h), w * 0.09, fill=body)
    rr(d, (x0 + w * 0.06, y0 + half - w * 0.03, x0 + w * 0.94, y0 + h - half + w * 0.03), w * 0.03, fill=body)
    # hinge line
    d.rectangle([x0 + w * 0.08, y0 + h / 2 - w * 0.008, x0 + w * 0.92, y0 + h / 2 + w * 0.008], fill=accent)
    # top screen
    sx0, sy0, sx1, sy1 = x0 + w * 0.17, y0 + w * 0.09, x0 + w * 0.83, y0 + half - w * 0.09
    rr(d, (sx0, sy0, sx1, sy1), w * 0.035, fill=screen_top)
    ga(d, (sx0 + sx1) / 2, (sy0 + sy1) / 2 + w * 0.01, (sy1 - sy0) * 0.78, ga_col)
    # bottom screen with "text lines"
    by0 = y0 + h - half
    bx0, bby0, bx1, bby1 = x0 + w * 0.27, by0 + w * 0.09, x0 + w * 0.73, by0 + half - w * 0.09
    rr(d, (bx0, bby0, bx1, bby1), w * 0.03, fill=screen_bot)
    lh = (bby1 - bby0)
    for i, frac in enumerate((0.78, 0.55)):
        ly = bby0 + lh * (0.32 + i * 0.3)
        rr(d, (bx0 + lh * 0.18, ly, bx0 + lh * 0.18 + (bx1 - bx0 - lh * 0.36) * frac, ly + lh * 0.13), lh * 0.06, fill=accent)
    # d-pad
    cx, cy, a = x0 + w * 0.135, by0 + half * 0.42, w * 0.05
    d.rectangle([cx - a * 1.5, cy - a / 2, cx + a * 1.5, cy + a / 2], fill=accent)
    d.rectangle([cx - a / 2, cy - a * 1.5, cx + a / 2, cy + a * 1.5], fill=accent)
    # face buttons
    bx, b = x0 + w * 0.865, w * 0.022
    for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
        px, py = bx + dx * b * 2.2, cy + dy * b * 2.2
        d.ellipse([px - b, py - b, px + b, py + b], fill=accent)

def icon(variant):
    im = Image.new('RGB', (S, S), DARK if variant != 'B' else Y); d = ImageDraw.Draw(im)
    w = S * 0.68; x0 = (S - w) / 2; y0 = (S - w * 1.18) / 2
    if variant == 'A':   # dark background, yellow device
        device(d, x0, y0, w, Y, DARK, DARK, Y, (90, 72, 30))
    elif variant == 'B': # yellow background, dark device, glowing 가
        device(d, x0, y0, w, DARK, (30, 34, 46), (30, 34, 46), Y, GREY)
    elif variant == 'C': # dark background, dark-grey device, yellow top screen
        device(d, x0, y0, w, (44, 48, 62), Y, (24, 27, 36), DARK, (110, 116, 132))
    return im

out = {}
for v in 'ABC':
    big = icon(v); out[v] = big
    big.resize((512, 512), Image.LANCZOS).save(f'icon-{v}-512.png')
# preview sheet: each option large + as it looks small with iOS rounded corners
sheet = Image.new('RGB', (3 * 300 + 80, 420), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
lab = ImageFont.truetype(FONT, 40)
for i, v in enumerate('ABC'):
    ic = out[v].resize((260, 260), Image.LANCZOS)
    mask = Image.new('L', (260, 260), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 259, 259], radius=58, fill=255)
    x = 20 + i * 310
    sheet.paste(ic, (x, 30), mask)
    small = out[v].resize((90, 90), Image.LANCZOS); m2 = Image.new('L', (90, 90), 0); ImageDraw.Draw(m2).rounded_rectangle([0, 0, 89, 89], radius=20, fill=255)
    sheet.paste(small, (x + 85, 305), m2)
    sd.text((x + 15, 300), v, font=lab, fill=(60, 60, 67))
sheet.save('icon-options.png')
print('ok')
