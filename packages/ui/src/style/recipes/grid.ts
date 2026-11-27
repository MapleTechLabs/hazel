import { defineRecipe } from "../recipe.ts"
import type { GridColumns, StackDensity } from "../schema.ts"

/**
 * `hz:grid` (phase 4): children in equal columns, the kit's card grids (`grid gap-4 md:grid-cols-2`,
 * KPI rows `grid-cols-3 gap-3`). Its gap is its `density`, as a stack's. The column tracks (one column
 * on compact, `columns` from regular, `auto` as many 16rem tracks as fit) are the web renderer's.
 */
export const grid = defineRecipe<
	{ readonly columns: GridColumns; readonly density: StackDensity },
	never,
	never
>({
	primitive: "grid",
	parts: {},
	base: { root: { fill: true } },
	options: {
		columns: {
			default: "auto",
			values: { auto: {}, "2": {}, "3": {}, "4": {} },
		},
		density: {
			default: "regular",
			values: {
				tight: { root: { gap: "0.5", rowGap: "0.5" } },
				compact: { root: { gap: "2", rowGap: "2" } },
				regular: { root: { gap: "4", rowGap: "4" } },
				relaxed: { root: { gap: "6", rowGap: "6" } },
				none: { root: { gap: "0", rowGap: "0" } },
				snug: { root: { gap: "3", rowGap: "3" } },
				loose: { root: { gap: "5", rowGap: "5" } },
			},
		},
	},
})
