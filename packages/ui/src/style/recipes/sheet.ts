import { defineRecipe } from "../recipe.ts"

/** `hz:sheet`: a panel with a title row and a close button; the renderer places it by size class. */
export const sheet = defineRecipe<{}, never, "panel" | "header" | "title" | "close" | "content">({
	primitive: "sheet",
	parts: {
		panel: "part",
		header: { kind: "part", in: "panel" },
		title: { kind: "part", in: "header" },
		close: { kind: "part", in: "header" },
		content: { kind: "part", in: "panel" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				layout: "column",
				rowGap: "4",
				paddingX: "4",
				paddingY: "4",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				shadow: "xs",
			},
			header: { layout: "row", align: "center", gap: "2" },
			title: { grow: true, truncate: true, text: "title", strong: true },
			close: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				radius: "md",
				color: "muted-fg",
				shrink: false,
				transition: "fast",
			},
			content: { layout: "column", rowGap: "4" },
		},
		regular: { parts: { panel: { paddingX: "6", paddingY: "6" }, close: { size: "7" } } },
	},
	options: {},
})
