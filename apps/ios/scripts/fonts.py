"""Turns the web app's Inter (@fontsource woff2) into TTFs the iOS app bundles: the same font files."""
import glob, os, sys
from fontTools.ttLib import TTFont

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = glob.glob(os.path.join(root, "../../node_modules/.bun/@fontsource+inter@*/node_modules/@fontsource/inter/files"))[0]
out = os.path.join(root, "build/fonts")
os.makedirs(out, exist_ok=True)
for weight in ("400", "500", "600", "700"):
    font = TTFont(os.path.join(source, f"inter-latin-{weight}-normal.woff2"))
    font.flavor = None
    font.save(os.path.join(out, f"Inter-{weight}.ttf"))
print(out)
