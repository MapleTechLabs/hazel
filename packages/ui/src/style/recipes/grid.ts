import { defineRecipe } from "../recipe.ts"
import type { GridColumns, StackDensity } from "../schema.ts"

/**
 * `hz:grid` (phase 4): children in equal columns (`grid-cols-*`, the kit's card grids). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const grid = defineRecipe<
	{ readonly columns: GridColumns; readonly density: StackDensity },
	never,
	never
>({
	primitive: "grid",
	parts: {},
	base: { root: {} },
	options: {
		columns: {
			default: "auto",
			values: { auto: {}, "2": {}, "3": {}, "4": {} },
		},
		density: {
			default: "regular",
			values: { tight: {}, compact: {}, regular: {}, relaxed: {} },
		},
	},
})
