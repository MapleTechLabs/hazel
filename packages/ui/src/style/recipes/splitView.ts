import { defineRecipe } from "../recipe.ts"

/**
 * `hz:splitView`: the app shell's sidebar beside its content (`shell/layout.ts`). Columns, the sidebar's
 * width and its edge are the web renderer's (`structure/splitView.ts`), which switch at the size class.
 */
export const splitView = defineRecipe<{}, never, "sidebar">({
	primitive: "splitView",
	parts: { sidebar: "slot" },
	base: {
		root: { background: "bg", fill: true },
		parts: { sidebar: { background: "sidebar" } },
	},
	options: {},
})
