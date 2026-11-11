# Layout and visual conformance

Compares the native Rune renderer with Chromium on the same Foldkit view of Hazel's `#general`
(offline fixture, 1280x800 points at 2x), element by element and pixel by pixel.

## What it measures

- **Layout.** The native host's `exportLayout` capture step against `getBoundingClientRect()` of
  every element under `#app` (svg subtrees excluded: native draws them as one node). Elements are
  paired by tag + own text (with ancestor text as context, so repeated names pair with the right
  message), then by identifying attributes (`data-slot`, `role`, `aria-label`, `href`, `src`,
  `placeholder`, `alt`), then structurally (parent of matched children, child index under a
  matched parent). Clock times and the build version are replaced by tokens before matching.
- For each pair drawn on screen on either side: `dx, dy, dw, dh` (native minus web, points), and
  the **own** delta, the part not inherited from the nearest matched ancestor. Own deltas show
  where a divergence starts; absolute deltas show how far it propagates.
- **Missing on native**: drawn on web (and on screen) but not natively. sr-only 1x1 boxes are
  ignored.
- **Pixels.** Share of pixels whose channels all differ by at most 24, overall and on a 16x10
  grid of 80pt tiles.

## Run

```bash
bun apps/native/bench/conformance/run.ts                       # boot + sent, light + dark
bun apps/native/bench/conformance/run.ts --scenario boot --theme dark
bun apps/native/bench/conformance/run.ts --check               # regression gate, exits 1 on failure
```

`--skip-build` reuses `apps/native/dist/entry.js`. The web side serves the prebuilt
`bench/web/dist` (build it with `bun apps/native/bench/web/run.ts` if it is missing) and the
native side needs `host/target/release/hazel-native`. A full run takes well under a minute.

## Reading the report

`out/summary.md` has one row per scenario and theme. Each `out/<scenario>-<theme>/` holds:

- `report.md`: summary table, worst tiles with crops, **divergence groups** (own deltas grouped
  by tag + className: start here for root causes), the 40 worst absolute and own deltas with web
  className and native path, element crops, and missing/extra element lists.
- `heatmap.png`: the web render faded, red where the native render differs, with the tile grid.
- `crops/tile-*.png`, `crops/element-*.png`: native on the left, web on the right. Element crops
  outline the web rect in cyan and the native rect in magenta.
- `report.json`: everything above as data; `native-layout.json` / `web-layout.json`: raw
  captures; `native.png` / `web.png`: the screenshots.

## Thresholds

`thresholds.json` holds per-run minimums (match rate, % within 4pt, pixel score) and maximums
(missing elements, p95 position error), set from a baseline with a little slack.
`--update-thresholds` rewrites them from the current run (min = value - 2, pixel score - 1;
max = value + 10% or + 3, p95 x 1.25 + 1). To tighten the gate after a renderer fix, run with
`--update-thresholds`, review the diff of `thresholds.json` (every number should move in the
better direction) and commit it; or edit single values by hand.
