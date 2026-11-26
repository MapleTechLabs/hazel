import { defineRecipe } from "../recipe.ts"

/** `typingIndicator` (`page/chat/banners.ts`): three dots and a caption; the bounce is renderer-owned. */
export const typingIndicator = defineRecipe<{}, never, "dots" | "dot" | "label">({
	primitive: "typingIndicator",
	parts: { dots: "part", dot: { kind: "part", in: "dots" }, label: "part" },
	base: {
		root: {
			layout: "row",
			align: "center",
			gap: "2",
			minHeight: "3",
			color: "muted-fg",
			text: "caption",
		},
		parts: {
			dots: { layout: "row", gap: "1" },
			dot: { size: "1.5", radius: "full", background: "muted-fg" },
		},
	},
	options: {},
})
