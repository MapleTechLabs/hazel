/**
 * What `hz:chart`'s renderer owns and its recipe cannot say: the grid of plot and axes, positions in
 * percent space, the plot heights per kind and size, tone colours on marks, and the phone breakpoint
 * (`max-md`) that thins the x labels. Typography, the legend and the tooltip surface are the recipe's.
 */
import type { ChartTone } from "../../../../vocabulary/content.ts"
import { ensureSheet } from "../../list/runtime.ts"

/**
 * Each tone's colour. HAZEL-GAP(chart-tone-tokens): Hazel has no `chart-*` colour tokens yet, so a
 * mark takes `--hz-color-chart-<tone>` once lane D adds it, else the host app's `--color-chart-*`
 * (exact inside the Foldkit app), else the nearest Hazel role.
 */
/** Today's `--chart-series-1`'s nearest Hazel colour (the heatmap's hue too). */
export const SERIES_1 = "var(--hz-palette-brand-700)"

const tones = {
	series1: ["series-1", SERIES_1],
	series2: ["series-2", "var(--hz-palette-brand-500)"],
	series3: ["series-3", "var(--hz-palette-brand-300)"],
	neutral: ["neutral", "var(--hz-color-muted-fg)"],
	new: ["new", "var(--hz-color-success)"],
	expansion: ["expansion", "var(--hz-palette-sky-500)"],
	contraction: ["contraction", "var(--hz-color-warning)"],
	churn: ["churn", "var(--hz-color-danger)"],
	accent: ["series-1", "var(--hz-color-primary)"],
	success: ["new", "var(--hz-color-success)"],
	warning: ["contraction", "var(--hz-color-warning)"],
	danger: ["churn", "var(--hz-color-danger)"],
} satisfies Record<ChartTone, readonly [host: string, fallback: string]>

/** A chart colour by its host name (`series-1`, `grid`), with the Hazel fallback (`chart-tone-tokens`). */
export const toneOf = (name: string, fallback: string) =>
	`var(--hz-color-chart-${name}, var(--color-chart-${name}, ${fallback}))`

const toneRules = Object.entries(tones)
	.map(
		([tone, [host, fallback]]) =>
			`[data-hz="chart"] [data-tone="${tone}"] { --hz-chart-tone: ${toneOf(host, fallback)}; }`,
	)
	.join("\n")

const SMALL = '[data-kind="sparkline"], [data-kind="barSparkline"], [data-kind="distribution"]'

const css = `
[data-hz="chart"] {
	--hz-chart-height: calc(var(--hz-space-4) * 13);
	--hz-chart-grid: ${toneOf("grid", "var(--hz-color-border)")};
	--hz-chart-net: ${toneOf("net", "var(--hz-color-fg)")};
	display: grid;
	grid-template-columns: var(--hz-space-12) minmax(0, 1fr) auto;
	grid-template-areas: "legend legend legend" "y plot end" ". x .";
	min-width: 0;
}
[data-hz="chart"]:is([data-kind="bar"], [data-kind="stackedBar"]) { --hz-chart-height: calc(var(--hz-space-14) * 4); }
/* HAZEL-GAP(chart-heights): today's h-44 and h-48 plots have no size step; small is h-32, large h-72. */
[data-hz="chart"][data-size="small"] { --hz-chart-height: calc(var(--hz-space-16) * 2); }
[data-hz="chart"][data-size="large"] { --hz-chart-height: calc(var(--hz-space-24) * 3); }
[data-hz="chart"] > [data-hz-part="legend"] { grid-area: legend; margin-block-start: 0; margin-inline: 0; padding: 0; list-style: none; }
[data-hz="chart"]:not([data-legend]) > [data-hz-part="legend"] { display: none; }
[data-hz="chart"] [data-hz-part="swatch"] { flex: none; background: var(--hz-chart-tone); }
[data-hz="chart"] [data-hz-part="swatch"][data-mark="square"] {
	width: var(--hz-space-2_5); height: var(--hz-space-2_5); border-radius: var(--hz-radius-xs);
}
[data-hz="chart"] [data-hz-part="swatch"][data-mark="dot"] {
	width: var(--hz-space-2); height: var(--hz-space-2); border-radius: var(--hz-radius-full);
}
[data-hz="chart"] [data-hz-part="swatch"][data-mark="line"] {
	width: var(--hz-space-3); height: var(--hz-space-0_5); border-radius: var(--hz-radius-full);
}
[data-hz="chart"] [data-hz-part="swatch"][data-net] { background: var(--hz-chart-net); }

[data-hz="chart"] > [data-hz-part="plot"] { grid-area: plot; position: relative; min-width: 0; height: var(--hz-chart-height); }
[data-hz="chart"] > [data-hz-part="axis"] { position: relative; }
[data-hz="chart"] > [data-hz-part="axis"][data-axis="y"] { grid-area: y; }
[data-hz="chart"] > [data-hz-part="axis"][data-axis="x"] { grid-area: x; height: var(--hz-space-6); }
[data-hz="chart"] > [data-hz-part="axis"][data-axis="end"] { grid-area: end; width: var(--hz-space-24); }
[data-hz="chart"] > [data-hz-part="axis"][data-axis="end"]:empty { display: none; }
[data-hz="chart"] [data-hz-part="tick"] { position: absolute; white-space: nowrap; }
[data-hz="chart"] [data-axis="y"] > [data-hz-part="tick"] { right: var(--hz-space-2); translate: 0 -50%; }
[data-hz="chart"] [data-axis="end"] > [data-hz-part="tick"] { left: var(--hz-space-2); translate: 0 -50%; }
[data-hz="chart"] [data-axis="end"] [data-hz-part="tickValue"] { color: var(--hz-color-fg); }
[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"] { top: var(--hz-space-1_5); translate: -50% 0; }
[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-edge="start"] { translate: 0 0; }
[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-edge="end"] { translate: -100% 0; }
[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-active] { color: var(--hz-color-fg); font-weight: var(--hz-weight-strong); }
@media (width < 48rem) {
	/* A phone keeps the first, middle and last dates (and the hovered one), and gives the plot the end labels' room. */
	[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-thin]:not([data-active]) { display: none; }
	[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-first] { translate: 0 0; }
	[data-hz="chart"] [data-axis="x"] > [data-hz-part="tick"][data-last] { translate: -100% 0; }
	[data-hz="chart"] > [data-hz-part="axis"][data-axis="end"] { display: none; }
}

[data-hz="chart"] [data-hz-part="layer"] { position: absolute; inset: 0; pointer-events: none; }
[data-hz="chart"] [data-hz-part="gridline"] { position: absolute; inset-inline: 0; border-top: 1px solid var(--hz-chart-grid); }
[data-hz="chart"] [data-hz-part="gridline"][data-zero] { border-top-color: color-mix(in oklab, var(--hz-color-fg-2) 50%, transparent); }
[data-hz="chart"] [data-hz-part="band"] { position: absolute; inset-block: 0; background: color-mix(in oklab, var(--hz-color-fg) 5%, transparent); }
[data-hz="chart"] [data-hz-part="segment"] { position: absolute; background: var(--hz-chart-tone); }
[data-hz="chart"] [data-hz-part="segment"][data-cap="up"] { border-start-start-radius: var(--hz-radius-sm); border-start-end-radius: var(--hz-radius-sm); }
[data-hz="chart"] [data-hz-part="segment"][data-cap="down"] { border-end-start-radius: var(--hz-radius-sm); border-end-end-radius: var(--hz-radius-sm); }
[data-hz="chart"] svg[data-hz-part="layer"] { width: 100%; height: 100%; overflow: visible; }
[data-hz="chart"] [data-hz-part="line"] { fill: none; stroke: var(--hz-chart-tone); }
[data-hz="chart"] [data-hz-part="line"][data-net] { stroke: var(--hz-chart-net); }
[data-hz="chart"] [data-hz-part="area"] { stroke: none; fill: color-mix(in oklab, var(--hz-chart-tone) 12%, transparent); }
[data-hz="chart"] [data-hz-part="crosshair"] {
	position: absolute; inset-block: 0; pointer-events: none;
	border-left: 1px solid color-mix(in oklab, var(--hz-color-fg-2) 60%, transparent);
}
[data-hz="chart"] [data-hz-part="dot"] {
	position: absolute; z-index: 2; pointer-events: none; translate: -50% -50%;
	width: var(--hz-space-2_5); height: var(--hz-space-2_5); border-radius: var(--hz-radius-full);
	background: var(--hz-chart-tone); box-shadow: 0 0 0 2px var(--hz-color-bg);
}
[data-hz="chart"] [data-hz-part="dot"][data-net] {
	width: var(--hz-space-2); height: var(--hz-space-2); background: var(--hz-chart-net); box-shadow: none;
}
[data-hz="chart"] [data-hz-part="tooltip"] {
	position: absolute; top: var(--hz-space-2); z-index: 10; pointer-events: none;
	min-width: calc(var(--hz-space-10) * 4);
}
[data-hz="chart"] [data-hz-part="tooltip"][hidden] { display: none; }
[data-hz="chart"] [data-hz-part="tooltipRows"] {
	display: grid; grid-template-columns: auto 1fr auto; align-items: center;
	column-gap: var(--hz-space-2_5); row-gap: var(--hz-space-1_5);
}
[data-hz="chart"] [data-hz-part="tooltipRow"] { display: contents; }
[data-hz="chart"] [data-hz-part="tooltipValue"] { text-align: right; }
[data-hz="chart"] [data-hz-part="tooltipRule"] {
	grid-column: 1 / -1; margin-block: var(--hz-space-0_5); border-top: 1px solid var(--hz-color-border);
}
[data-hz="chart"] [data-hz-part="tooltipRow"][data-total] > [data-hz-part="tooltipLabel"] {
	color: var(--hz-color-fg); font-weight: var(--hz-weight-strong);
}

/* The small kinds (W2b): the plot alone, no axes or legend; each kind sets the plot's box. */
[data-hz="chart"]:is(${SMALL}) { display: flex; flex-direction: column; }
[data-hz="chart"]:is(${SMALL}) > :is([data-hz-part="axis"], [data-hz-part="legend"]) { display: none; }
/* A sparkline: today's \`sm\` (h-6 w-20, inline) and \`md\` (h-8 w-30, cards), shrinking in a tile. */
[data-hz="chart"][data-kind="sparkline"] {
	--hz-chart-height: var(--hz-space-6); width: var(--hz-space-20); flex: none;
}
[data-hz="chart"][data-kind="sparkline"][data-size="large"] {
	--hz-chart-height: var(--hz-space-8); width: calc(var(--hz-space-10) * 3); flex: 0 1 auto; min-width: 0;
}
[data-hz="chart"] svg[data-hz-part="spark"] { display: block; width: 100%; height: 100%; overflow: visible; }
[data-hz="chart"] [data-hz-part="endDot"] { fill: var(--hz-chart-tone); }
/* The evidence bars (\`evidenceBars\`): h-16 by default, the signals preview's h-24 at large. */
[data-hz="chart"][data-kind="barSparkline"] { --hz-chart-height: var(--hz-space-16); width: 100%; }
[data-hz="chart"][data-kind="barSparkline"][data-size="small"] { --hz-chart-height: var(--hz-space-8); }
[data-hz="chart"][data-kind="barSparkline"][data-size="large"] { --hz-chart-height: var(--hz-space-24); }
[data-hz="chart"][data-kind="barSparkline"] > [data-hz-part="plot"] { display: flex; align-items: flex-end; gap: var(--hz-space-px); }
[data-hz="chart"] [data-hz-part="bar"] {
	display: block; min-height: var(--hz-space-px); background: var(--hz-chart-tone);
	border-start-start-radius: var(--hz-radius-xs); border-start-end-radius: var(--hz-radius-xs);
}
[data-hz="chart"] [data-hz-part="bar"][data-rest] { background: color-mix(in oklab, ${toneOf("neutral", "var(--hz-color-muted-fg)")} 60%, transparent); }
[data-hz="chart"] [data-hz-part="baseline"] {
	position: absolute; inset-inline: 0; pointer-events: none; border-top: 1px dashed var(--hz-color-fg-2);
}
/* The 100% bar (\`distributionBar\`): h-2.5, rounded, on the secondary fill. */
[data-hz="chart"][data-kind="distribution"] { --hz-chart-height: var(--hz-space-2_5); width: 100%; }
[data-hz="chart"][data-kind="distribution"][data-size="small"] { --hz-chart-height: var(--hz-space-1_5); }
[data-hz="chart"][data-kind="distribution"][data-size="large"] { --hz-chart-height: var(--hz-space-3); }
[data-hz="chart"][data-kind="distribution"] > [data-hz-part="plot"] {
	display: flex; gap: var(--hz-space-0_5); overflow: hidden;
	border-radius: var(--hz-radius-full); background: var(--hz-color-secondary);
}
[data-hz="chart"] [data-hz-part="share"] { display: block; height: 100%; background: var(--hz-chart-tone); }
[data-hz="chart"] [data-hz-part="share"]:first-child { border-start-start-radius: var(--hz-radius-full); border-end-start-radius: var(--hz-radius-full); }
[data-hz="chart"] [data-hz-part="share"]:last-child { border-start-end-radius: var(--hz-radius-full); border-end-end-radius: var(--hz-radius-full); }

/* Loading: the plot's skeleton alone, today's \`skeleton(h, "h-32 w-full rounded-lg")\`. */
[data-hz="chart"] > [data-hz-part="skeleton"] { display: none; grid-column: 1 / -1; height: var(--hz-chart-height); }
[data-hz="chart"][data-loading] > [data-hz-part="skeleton"] { display: block; }
[data-hz="chart"][data-loading] > :not([data-hz-part="skeleton"]) { display: none; }
${toneRules}
`

export const ensureChartStyles = (document: Document) => ensureSheet(document, "chart", css)
