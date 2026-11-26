import { defineRecipe } from "../recipe.ts"

/** `hz:spacer`: takes the stack's free space, pushing what follows to the far end. */
export const spacer = defineRecipe<{}, never, never>({
	primitive: "spacer",
	parts: {},
	base: { root: { grow: true, shrink: true } },
	options: {},
})
