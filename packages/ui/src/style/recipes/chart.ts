import { defineRecipe } from "../recipe.ts"
import type { ChartKind, ChartSize } from "../schema.ts"

/**
 * `hz:chart` (phase 4): today's SVG charts (`customers/charts`): plot, axes, legend, crosshair and
 * tooltip. The legend is `chartLegend` (`gap-x-4 gap-y-1 text-sm text-muted-fg`, `gap-1.5` per
 * entry); ticks are `text-xs tabular-nums text-muted-fg`; the tooltip is `chartTooltip` (`rounded-lg
 * border-fg/10 bg-overlay px-3 py-2.5 text-sm shadow-md`). Positions, heights and tone colours are the
 * renderer's (`web/primitives/content/chart/styles.ts`); sizes and kinds change only those.
 */
export const chart = defineRecipe<
	{ readonly kind: ChartKind; readonly size: ChartSize },
	"legend" | "loading",
	| "plot"
	| "axis"
	| "tick"
	| "tickValue"
	| "legend"
	| "legendItem"
	| "swatch"
	| "tooltip"
	| "tooltipHeading"
	| "tooltipRows"
	| "tooltipRow"
	| "tooltipLabel"
	| "tooltipValue"
	| "skeleton"
>({
	primitive: "chart",
	parts: {
		plot: "part",
		axis: "part",
		tick: { kind: "part", in: "axis" },
		tickValue: { kind: "part", in: "tick" },
		legend: "part",
		legendItem: { kind: "part", in: "legend" },
		swatch: { kind: "part", in: "legendItem" },
		tooltip: { kind: "part", in: "plot" },
		tooltipHeading: { kind: "part", in: "tooltip" },
		tooltipRows: { kind: "part", in: "tooltip" },
		tooltipRow: { kind: "part", in: "tooltipRows" },
		tooltipLabel: { kind: "part", in: "tooltipRow" },
		tooltipValue: { kind: "part", in: "tooltipRow" },
		skeleton: "part",
	},
	base: {
		root: {},
		parts: {
			axis: { text: "caption", color: "muted-fg", numeric: true },
			legend: {
				layout: "row",
				wrap: true,
				align: "center",
				gap: "4",
				rowGap: "1",
				marginBottom: "4",
				text: "label",
				color: "muted-fg",
			},
			legendItem: { layout: "inline-row", align: "center", gap: "1.5" },
			tooltip: {
				background: "overlay",
				color: "overlay-fg",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				radius: "lg",
				shadow: "md",
				paddingX: "3",
				paddingY: "2.5",
				text: "label",
			},
			tooltipHeading: { strong: true, color: "fg", marginBottom: "2" },
			tooltipLabel: { color: "muted-fg" },
			tooltipValue: { strong: true, color: "fg", numeric: true },
			skeleton: { radius: "lg", background: "muted" },
		},
	},
	options: {
		kind: {
			default: "line",
			values: {
				line: {},
				area: {},
				bar: {},
				stackedBar: {},
				sparkline: {},
				barSparkline: {},
				distribution: {},
			},
		},
		size: {
			default: "regular",
			values: { regular: {}, small: {}, large: {} },
		},
	},
	flags: { legend: {}, loading: {} },
	motion: { loop: [{ motion: "skeletonPulse", part: "skeleton" }] },
})
