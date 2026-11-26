import { defineRecipe } from "../recipe.ts"
import { type MenuListPart, menuListParts, menuListStyles } from "./menu.ts"

/** `hz:contextMenu`: its region lays out as its children would; the panel is the menu's (`menu.ts`). */
export const contextMenu = defineRecipe<{}, never, MenuListPart | "content">({
	primitive: "contextMenu",
	parts: { ...menuListParts, content: "part" },
	base: {
		root: { layout: "contents" },
		parts: { ...menuListStyles, content: { layout: "contents" } },
		regular: { parts: { item: { minHeight: "8", text: "label" } } },
	},
	options: {},
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
