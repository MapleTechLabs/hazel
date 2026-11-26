import { defineRecipe } from "../recipe.ts"

/**
 * `hz:tableRow` (phase 4): a table row: hover and selected washes, the keyboard row, group and footer rows. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const tableRow = defineRecipe<{}, never, "selectCell" | "actions">({
	primitive: "tableRow",
	parts: {
		selectCell: "part",
		actions: "slot",
	},
	base: { root: {} },
	options: {},
})
