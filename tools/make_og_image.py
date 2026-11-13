"""Renders tools/og_image.html to docs/og.jpg (1200x630), the image shown when the app's link is shared."""
import os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1200, 'height': 630})
    pg.goto('file://' + os.path.join(here, 'og_image.html')); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(here, '..', 'docs', 'og.jpg'), type='jpeg', quality=88); b.close()
