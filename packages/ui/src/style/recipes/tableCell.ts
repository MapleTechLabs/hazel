import { defineRecipe } from "../recipe.ts"

/**
 * `hz:tableCell` (phase 4): a table cell, padded and aligned by its column. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const tableCell = defineRecipe<{}, never, never>({
	primitive: "tableCell",
	parts: {},
	base: { root: {} },
	options: {},
})
