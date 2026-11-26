import { defineRecipe } from "../recipe.ts"
import type { StackAlign, StackAxis, StackDensity } from "../schema.ts"

/**
 * `hz:stack`: a column or row whose gap is its `density` (the kit's `gap-2`, `gap-4`, `gap-6`).
 * `align` places children across the axis; `end` is drawn by the web renderer (no recipe value yet).
 */
export const stack = defineRecipe<
	{ readonly axis: StackAxis; readonly density: StackDensity; readonly align: StackAlign },
	never,
	never
>({
	primitive: "stack",
	parts: {},
	base: { root: { layout: "column" } },
	options: {
		axis: {
			default: "vertical",
			values: {
				vertical: { root: { layout: "column" } },
				horizontal: { root: { layout: "row" } },
			},
		},
		density: {
			default: "regular",
			values: {
				compact: { root: { gap: "2", rowGap: "2" } },
				regular: { root: { gap: "4", rowGap: "4" } },
				relaxed: { root: { gap: "6", rowGap: "6" } },
			},
		},
		align: {
			default: "stretch",
			values: {
				stretch: {},
				start: { root: { align: "start" } },
				center: { root: { align: "center" } },
				end: {},
			},
		},
	},
})
