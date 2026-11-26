import { defineRecipe } from "../recipe.ts"

/**
 * `hz:dialog` (the kit's `modal.ts` panel): a card with a title, a muted description, then the
 * content with its `actions` slot last (placed by the renderer). A destructive dialog's title is red.
 */
export const dialog = defineRecipe<
	{},
	never,
	"panel" | "header" | "title" | "description" | "content" | "actions"
>({
	primitive: "dialog",
	parts: {
		panel: "part",
		header: { kind: "part", in: "panel" },
		title: { kind: "part", in: "header" },
		description: { kind: "part", in: "header" },
		content: { kind: "part", in: "panel" },
		actions: { kind: "slot", in: "content" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				layout: "column",
				rowGap: "4",
				paddingX: "5",
				paddingY: "5",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				shadow: "overlay",
			},
			header: { layout: "column", rowGap: "1" },
			title: { text: "title", weight: "semibold" },
			description: { text: "body", color: "muted-fg" },
			content: { layout: "column", rowGap: "4" },
			actions: { gap: "2" },
		},
		regular: { parts: { panel: { paddingX: "6", paddingY: "6" } } },
	},
	options: {},
	states: { destructive: { parts: { title: { color: "danger-subtle-fg" } } } },
})
