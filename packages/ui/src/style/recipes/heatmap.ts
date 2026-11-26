import { defineRecipe } from "../recipe.ts"

/**
 * `hz:heatmap` (phase 4): the calendar heatmap (`charts/calendar-heatmap.ts`): day cells by level, month labels, legend. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const heatmap = defineRecipe<{}, never, "grid" | "day" | "months" | "legend">({
	primitive: "heatmap",
	parts: {
		grid: "part",
		day: { kind: "part", in: "grid" },
		months: "part",
		legend: "part",
	},
	base: { root: {} },
	options: {},
})
