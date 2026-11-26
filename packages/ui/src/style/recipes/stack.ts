import { defineRecipe } from "../recipe.ts"

/** A plain column of children (`hz:stack`): the root an island or screen needs when it has several. */
export const stack = defineRecipe<{}, never, never>({
	primitive: "stack",
	parts: {},
	base: { root: { layout: "column" } },
	options: {},
})
