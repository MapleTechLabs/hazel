import { defineRecipe } from "../recipe.ts"
import type { StackAxis } from "../schema.ts"

/** `hz:scroll`: fills what its container gives it and scrolls along `axis` (`recipe-overflow`). */
export const scroll = defineRecipe<{ readonly axis: StackAxis }, never, never>({
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
	},
})
