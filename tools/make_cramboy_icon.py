"""Draws the CramBoy app icon (pixel art) into docs/icon-512.png and docs/icon-180.png.
Run: python3 tools/make_cramboy_icon.py"""
from PIL import Image
import os

# 16 x 16 grid, 32 px per cell. C cream, D dark orange, O orange.
BOX = [
    "................",
    "................",
    "....C...O...C...",
    ".....C..O..C....",
    "................",
    ".CC..........CC.",
    "..CCC......CCC..",
    "..CCCCCCCCCCCCD.",
    "..CCCCCCCCCCCCD.",
    "..CCDCCCCCCOCCD.",
    "..CDDDCCCCOCOCD.",
    "..CCDCCCCCCOCCD.",
    "..CCCCCCCCCCCCD.",
    "...DDDDDDDDDDDD.",
    "................",
    "................",
]
COL = {'C': (255, 248, 231), 'D': (194, 97, 15), 'O': (247, 162, 58)}
TOP, BOT = (255, 217, 102), (247, 149, 42)

CELL = 30   # px per pixel; the 16 x 16 map is drawn smaller than the icon so it has room around it

def draw():
    img = Image.new('RGB', (512, 512))
    px = img.load()
    # Background: 16 flat bands from light to deep amber, like the old icon.
    for band in range(16):
        t = band / 15
        c = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3))
        for y in range(band * 32, band * 32 + 32):
            for x in range(512):
                px[x, y] = c
    # The drawing covers map columns 1..14 and rows 2..13: centre that block in the icon.
    ox = round(256 - 8 * CELL); oy = round(256 - 8 * CELL)

    def cell(x0, y0, size, col):
        for y in range(int(y0), int(y0 + size)):
            for x in range(int(x0), int(x0 + size)):
                px[x, y] = col
    for gy, row in enumerate(BOX):
        for gx, ch in enumerate(row):
            if ch in COL:
                cell(ox + gx * CELL, oy + gy * CELL, CELL, COL[ch])
    # Two small pixel sparkles (half-size pixels) in the top corners of the drawing.
    h = CELL // 2
    for cx, cy in [(ox + 1.5 * CELL, oy + 1.5 * CELL - 8), (ox + 14.5 * CELL, oy + 1.5 * CELL - 8)]:
        for dx, dy in [(0, 0), (-h, 0), (h, 0), (0, -h), (0, h)]:
            cell(cx + dx - h / 2, cy + dy - h / 2, h, COL['C'])
    return img

here = os.path.dirname(os.path.abspath(__file__))
big = draw()
big.save(os.path.join(here, '..', 'docs', 'icon-512.png'))
big.resize((180, 180), Image.LANCZOS).save(os.path.join(here, '..', 'docs', 'icon-180.png'))
