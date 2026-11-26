import { defineRecipe } from "../recipe.ts"

/**
 * `hz:actionBar` (phase 4): the bulk-action bar over the page's bottom edge (`page/customers/list/view.ts`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const actionBar = defineRecipe<{}, never, "label" | "actions" | "dismiss">({
	primitive: "actionBar",
	parts: {
		label: "part",
		actions: "slot",
		dismiss: "part",
	},
	base: { root: {} },
	options: {},
})
