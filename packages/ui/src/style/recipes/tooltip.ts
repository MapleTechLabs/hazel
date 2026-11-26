import { defineRecipe } from "../recipe.ts"

/** `hz:tooltip` (the kit's `tooltip.ts`): a small inverted label; placement and timing are the renderer's. */
export const tooltip = defineRecipe<{}, never, "content" | "bubble">({
	primitive: "tooltip",
	parts: { content: "part", bubble: "part" },
	base: {
		root: { layout: "contents" },
		parts: {
			content: { layout: "contents" },
			bubble: {
				paddingX: "2",
				paddingY: "1",
				radius: "md",
				background: "fg",
				color: "bg",
				text: "caption",
				strong: true,
				nowrap: true,
			},
		},
	},
	options: {},
})
