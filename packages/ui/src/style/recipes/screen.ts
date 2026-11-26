import { defineRecipe } from "../recipe.ts"

/** A screen: a title bar over its content (the spike's channel list, `Theme.swift`'s measured look). */
export const screen = defineRecipe<{}, never, "header" | "back" | "title" | "content" | "toolbar">({
	primitive: "screen",
	parts: {
		header: "part",
		back: { kind: "part", in: "header" },
		title: { kind: "part", in: "header" },
		content: "part",
		toolbar: { kind: "slot", in: "content" },
	},
	base: {
		root: { layout: "column", background: "sidebar" },
		parts: {
			header: {
				layout: "row",
				align: "center",
				gap: "2",
				minHeight: "14",
				paddingX: "6",
				divider: "separator",
			},
			// The back button: a quiet square, as a section's header action.
			back: {
				size: "8",
				paddingX: "2",
				radius: "lg",
				color: "fg-3",
				bleedX: "2",
				shrink: false,
				transition: "fast",
			},
			title: { text: "label", strong: true, color: "fg", opacity: 0.8 },
			// Sections pad themselves, as in the sidebar; extensions add their own space below.
			content: { layout: "column", paddingY: "3" },
			toolbar: { gap: "1" },
		},
	},
	options: {},
})
