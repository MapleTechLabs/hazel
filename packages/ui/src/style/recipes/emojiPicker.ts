import { defineRecipe } from "../recipe.ts"

/**
 * `hz:emojiPicker` (the app's `emoji-picker/view.ts`): a panel with a search field, category titles
 * and a grid of emoji buttons. The grid's columns, hover and focus rings are the renderer's.
 */
export const emojiPicker = defineRecipe<
	{},
	never,
	"panel" | "search" | "grid" | "category" | "categoryTitle" | "emojis" | "emoji" | "empty"
>({
	primitive: "emojiPicker",
	parts: {
		panel: "part",
		search: { kind: "part", in: "panel" },
		grid: { kind: "part", in: "panel" },
		category: { kind: "part", in: "grid" },
		categoryTitle: { kind: "part", in: "category" },
		emojis: { kind: "part", in: "category" },
		emoji: { kind: "part", in: "emojis" },
		empty: { kind: "part", in: "panel" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				rowGap: "2",
				paddingX: "2",
				paddingY: "2",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				shadow: "overlay",
			},
			search: {
				minHeight: "9",
				paddingX: "2.5",
				radius: "md",
				background: "secondary",
				color: "fg",
				text: "body",
			},
			category: { layout: "column" },
			categoryTitle: { paddingX: "1", paddingY: "1", text: "caption", strong: true, color: "muted-fg" },
			emoji: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "9",
				radius: "md",
				text: "title",
			},
			empty: { paddingY: "4", text: "caption", color: "muted-fg" },
		},
		regular: { parts: { search: { minHeight: "8", text: "label" }, emoji: { size: "8" } } },
	},
	options: {},
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
