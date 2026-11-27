"""An icon's <text> as an SVG path in Inter, so CoreSVG draws it the same on every machine.
  python3 scripts/outline-text.py GIF 6 700 9 12.5   text, font size, weight, centre x, baseline y
Prints the path's `d`; `export-icons.ts` keeps it (`textOutlines`). Needs build/fonts (scripts/fonts.py)."""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

text, size, weight, cx, baseline = sys.argv[1], float(sys.argv[2]), sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
font = TTFont(os.path.join(root, f"build/fonts/Inter-{weight}.ttf"))
glyphs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
scale = size / font["head"].unitsPerEm
names = [cmap[ord(c)] for c in text]
width = sum(hmtx[n][0] for n in names) * scale
pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
x = cx - width / 2
for name in names:
    # Font units are y-up; SVG is y-down from the baseline.
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
    x += hmtx[name][0] * scale
print(pen.getCommands())
