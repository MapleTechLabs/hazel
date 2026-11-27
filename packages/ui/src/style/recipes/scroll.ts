import { defineRecipe } from "../recipe.ts"
import type { StackAxis, StackInset } from "../schema.ts"

/** `hz:scroll`: fills what its container gives it and scrolls along `axis` (`recipe-overflow`); `inset` as a stack's. */
export const scroll = defineRecipe<{ readonly axis: StackAxis; readonly inset: StackInset }, never, never>({
	primitive: "scroll",
	parts: {},
	base: { root: { grow: true, shrink: true, minHeight: "0" } },
	options: {
		axis: {
			default: "vertical",
			values: {
				vertical: { root: { layout: "column", overflow: "scrollY" } },
				horizontal: { root: { layout: "row", overflow: "scrollX" } },
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
})
