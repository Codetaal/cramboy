# Final direction: original gold CheeseLab flask + blue round "DS" marker, top-right, tall pixel letters.
import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open('./badge2.py').read().split("V = [")[0])
GOLD_T, GOLD_B = (255, 214, 92), (247, 150, 38)
B_FILL, B_HI, B_SHADOW = (58, 112, 206), (128, 176, 240), (176, 84, 10)
def marker(im, cx=40.5, cy=10.5, r=7.2, letters=(255, 255, 250)):
    d = ImageDraw.Draw(im)
    def cell(x, y, col): d.rectangle((x * G, y * G, (x + 1) * G - 1, (y + 1) * G - 1), fill=col)
    disc = {(x, y) for x in range(52) for y in range(52) if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r}
    for x, y in disc: cell(x + 1, y + 1, B_SHADOW)        # hard shadow in the flask's shadow colour
    for x, y in disc: cell(x, y, B_FILL)
    for x, y in disc:
        if (x, y - 1) not in disc: cell(x, y, B_HI)       # top highlight row
    t, tw, th = glyph_cells('tall')
    ox = round(cx - tw / 2); oy = round(cy - th / 2)
    for x, y in t: cell(ox + x, oy + y, letters)
    return im
outs = {}
for k, col in (('white', (255, 255, 250)), ('navy', (20, 36, 90))):
    im = marker(icon(GOLD_T, GOLD_B, CHEESE), letters=col); im.save(f'./ds-final-{k}.png'); outs[k] = im
lab = ImageFont.truetype(FONT, 24)
sheet = Image.new('RGB', (2 * 330 + 30, 330), (242, 242, 247)); sd = ImageDraw.Draw(sheet)
for i, (k, name) in enumerate((('white', 'White letters'), ('navy', 'Dark letters'))):
    x = 20 + i * 330
    t = outs[k].resize((220, 220), Image.LANCZOS); sheet.paste(t, (x, 20), rmask((220, 220), (0, 0, 219, 219), 50))
    s = outs[k].resize((74, 74), Image.LANCZOS); sheet.paste(s, (x + 232, 166), rmask((74, 74), (0, 0, 73, 73), 17))
    sd.text((x, 262), name, font=lab, fill=(50, 50, 56))
sheet.save('icon-preview.png')
sheet.save('icon-preview.png'); print('ok')
