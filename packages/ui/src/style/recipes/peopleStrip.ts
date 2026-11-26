import { defineRecipe } from "../recipe.ts"

/** `hz:peopleStrip`: a phase 1.5 stub; lane A1 fills it with the primitive, lane D reviews it. */
export const peopleStrip = defineRecipe<{}, never, never>({
	primitive: "peopleStrip",
	parts: {},
	base: { root: {} },
	options: {},
})
