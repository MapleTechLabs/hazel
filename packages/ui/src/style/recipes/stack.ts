import { defineRecipe } from "../recipe.ts"
import type { StackAlign, StackAxis, StackDensity, StackInset } from "../schema.ts"

/**
 * `hz:stack`: a column or row whose gap is its `density` (the kit's `gap-2`, `gap-4`, `gap-6`).
 * `align` places children across the axis; `inset` pads it as a page's gutter (`p-4`) or header
 * (`px-4 py-3`); `wrap` lets a row's children wrap; `regularOnly` draws it only at the regular size class.
 */
export const stack = defineRecipe<
	{
		readonly axis: StackAxis
		readonly density: StackDensity
		readonly align: StackAlign
		readonly inset: StackInset
	},
	"wrap" | "regularOnly",
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
				tight: { root: { gap: "0.5", rowGap: "0.5" } },
				snug: { root: { gap: "1.5", rowGap: "1.5" } },
				compact: { root: { gap: "2", rowGap: "2" } },
				cozy: { root: { gap: "3", rowGap: "3" } },
				regular: { root: { gap: "4", rowGap: "4" } },
				relaxed: { root: { gap: "6", rowGap: "6" } },
				none: { root: { gap: "0", rowGap: "0" } },
				loose: { root: { gap: "5", rowGap: "5" } },
			},
		},
		align: {
			default: "stretch",
			values: {
				stretch: {},
				start: { root: { align: "start" } },
				center: { root: { align: "center" } },
				// Its lines' text too (`pk0-evidence-lines`: today's `items-end text-right`).
				end: { root: { align: "end", textAlign: "end" } },
			},
		},
		inset: {
			default: "none",
			values: {
				none: {},
				page: { root: { paddingX: "4", paddingY: "4" } },
				bar: { root: { paddingX: "4", paddingY: "3" } },
			},
		},
	},
	flags: {
		wrap: { root: { wrap: true } },
		regularOnly: { root: { hidden: true } },
	},
	compounds: [
		// Shown again from the regular size class, in its own axis.
		{ when: { axis: "vertical", regularOnly: true }, style: { regular: { root: { layout: "column" } } } },
		{ when: { axis: "horizontal", regularOnly: true }, style: { regular: { root: { layout: "row" } } } },
	],
})
