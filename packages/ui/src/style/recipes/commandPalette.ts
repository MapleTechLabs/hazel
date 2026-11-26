import { defineRecipe } from "../recipe.ts"

/**
 * `hz:commandPalette` (phase 4): the command palette (`ui/command-menu-view.ts`): query field, grouped results, empty line. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A3 fills it from today's kit (lane D reviews).
 */
export const commandPalette = defineRecipe<{}, never, "field" | "results" | "group" | "item" | "empty">({
	primitive: "commandPalette",
	parts: {
		field: "part",
		results: "part",
		group: { kind: "part", in: "results" },
		item: { kind: "part", in: "group" },
		empty: "part",
	},
	base: { root: {} },
	options: {},
})
