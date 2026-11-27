import { defineRecipe } from "../recipe.ts"

/** `hz:navigation`: a stack of screens; only the top one shows (the web renderer hides the rest). */
export const navigation = defineRecipe<{}, never, never>({
	primitive: "navigation",
	parts: {},
	base: { root: { fill: true } },
	options: {},
})
