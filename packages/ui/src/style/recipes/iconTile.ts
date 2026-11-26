import { defineRecipe } from "../recipe.ts"

/** `hz:iconTile`: a phase 1.5 stub; lane A1 fills it with the primitive, lane D reviews it. */
export const iconTile = defineRecipe<{}, never, never>({
	primitive: "iconTile",
	parts: {},
	base: { root: {} },
	options: {},
})
