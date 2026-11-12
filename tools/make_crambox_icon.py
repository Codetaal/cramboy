"""Draws the CramBox app icon (pixel art) into docs/icon-512.png and docs/icon-180.png.
Run: python3 tools/make_crambox_icon.py"""
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
    for gy, row in enumerate(BOX):
        for gx, ch in enumerate(row):
            if ch in COL:
                for y in range(gy * 32, gy * 32 + 32):
                    for x in range(gx * 32, gx * 32 + 32):
                        px[x, y] = COL[ch]
    # Two small pixel sparkles (16 px cells), as on the old icon.
    for cx, cy in [(56, 56), (456, 56)]:
        for dx, dy in [(0, 0), (-16, 0), (16, 0), (0, -16), (0, 16)]:
            for y in range(cy + dy - 8, cy + dy + 8):
                for x in range(cx + dx - 8, cx + dx + 8):
                    px[x, y] = COL['C']
    return img

here = os.path.dirname(os.path.abspath(__file__))
big = draw()
big.save(os.path.join(here, '..', 'docs', 'icon-512.png'))
big.resize((180, 180), Image.LANCZOS).save(os.path.join(here, '..', 'docs', 'icon-180.png'))
