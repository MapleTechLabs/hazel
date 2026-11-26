import { defineRecipe } from "../recipe.ts"

/**
 * `hz:avatarStack`: avatars overlapping in a row (the sidebar's group DM), each cut from the next by
 * a ring of the page, then the `+N` overflow count.
 */
export const avatarStack = defineRecipe<{}, never, "children" | "overflow">({
	primitive: "avatarStack",
	parts: { children: "children", overflow: "part" },
	base: {
		root: { layout: "inline-row", align: "center", shrink: false },
		parts: {
			children: { bleedX: "0.5", ring: "bg" },
			overflow: { paddingStart: "1.5", text: "tiny", numeric: true, color: "muted-fg", nowrap: true },
		},
	},
	options: {},
})
