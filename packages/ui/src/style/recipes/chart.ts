import { defineRecipe } from "../recipe.ts"
import type { ChartKind, ChartSize } from "../schema.ts"

/**
 * `hz:chart` (phase 4): today's SVG charts (`customers/charts`): plot, axes, legend, crosshair and tooltip. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const chart = defineRecipe<
	{ readonly kind: ChartKind; readonly size: ChartSize },
	never,
	"plot" | "axis" | "legend" | "tooltip"
>({
	primitive: "chart",
	parts: {
		plot: "part",
		axis: "part",
		legend: "part",
		tooltip: "part",
	},
	base: { root: {} },
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
})
