import { defineRecipe } from "../recipe.ts"

/**
 * `hz:dropZone` (phase 4): the dashed file target (`page/shared/drop-zone.ts`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A2 fills it from today's kit (lane D reviews).
 */
export const dropZone = defineRecipe<{}, never, "icon" | "label" | "description">({
	primitive: "dropZone",
	parts: {
		icon: "part",
		label: "part",
		description: "part",
	},
	base: { root: {} },
	options: {},
})
