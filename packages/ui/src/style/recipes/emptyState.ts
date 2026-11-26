import { defineRecipe } from "../recipe.ts"

/** `hz:emptyState`: a phase 1.5 stub; lane A1 fills it with the primitive, lane D reviews it. */
export const emptyState = defineRecipe<{}, never, never>({
	primitive: "emptyState",
	parts: {},
	base: { root: {} },
	options: {},
})
