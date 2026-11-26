import { defineRecipe } from "../recipe.ts"

/** `hz:progress`: a phase 1.5 stub; lane A1 fills it with the primitive, lane D reviews it. */
export const progress = defineRecipe<{}, never, never>({
	primitive: "progress",
	parts: {},
	base: { root: {} },
	options: {},
})
