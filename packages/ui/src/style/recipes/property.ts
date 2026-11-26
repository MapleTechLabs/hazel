import { defineRecipe } from "../recipe.ts"

/**
 * `hz:property` (phase 4): a label and value row (`page/customers/detail/parts.ts` `property`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const property = defineRecipe<{}, never, "label" | "description" | "value">({
	primitive: "property",
	parts: {
		label: "part",
		description: "part",
		value: "part",
	},
	base: { root: {} },
	options: {},
})
