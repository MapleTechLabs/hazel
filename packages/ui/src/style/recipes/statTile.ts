import { defineRecipe } from "../recipe.ts"
import type { StatDeltaTone, StatTrend } from "../schema.ts"

/**
 * `hz:statTile` (phase 4): the KPI tile (`customers/ui/kpi-tile.ts`): label, value, delta pill, comparison, sparkline. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const statTile = defineRecipe<
	{ readonly trend: StatTrend; readonly deltaTone: StatDeltaTone },
	never,
	"label" | "value" | "detail" | "delta" | "comparison" | "chart" | "action"
>({
	primitive: "statTile",
	parts: {
		label: "part",
		value: "part",
		detail: "part",
		delta: "part",
		comparison: "part",
		chart: "slot",
		action: "slot",
	},
	base: { root: {} },
	options: {
		trend: {
			default: "none",
			values: { none: {}, up: {}, down: {} },
		},
		deltaTone: {
			default: "neutral",
			values: { neutral: {}, success: {}, danger: {} },
		},
	},
})
