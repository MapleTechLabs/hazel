import { defineRecipe } from "../recipe.ts"

/** A screen: a title bar over its content (the spike's channel list, `Theme.swift`'s measured look). */
export const screen = defineRecipe<{}, never, "header" | "title" | "content">({
	primitive: "screen",
	parts: { header: "part", title: { kind: "part", in: "header" }, content: "part" },
	base: {
		root: { layout: "column", background: "sidebar" },
		parts: {
			header: { layout: "row", align: "center", minHeight: "14", paddingX: "6", divider: "separator" },
			title: { text: "label", strong: true, color: "fg", opacity: 0.8 },
			// Sections pad themselves, as in the sidebar; extensions add their own space below.
			content: { layout: "column", paddingY: "3" },
		},
	},
	options: {},
})
