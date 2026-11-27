import { defineRecipe } from "../recipe.ts"
import type { SheetStyle } from "../schema.ts"

/**
 * `hz:sheet`: a panel with a title row and a close button (the kit's `dialogCloseIconBase`); the
 * renderer places it by size class and style.
 */
export const sheet = defineRecipe<
	{ readonly style: SheetStyle },
	never,
	"panel" | "header" | "title" | "close" | "content"
>({
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
				shadow: "overlay",
			},
			header: { layout: "row", align: "center", gap: "2" },
			title: { grow: true, truncate: true, text: "title", weight: "semibold" },
			close: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				radius: "lg",
				color: "fg-2",
				shrink: false,
				transition: "fast",
			},
			content: { layout: "column", rowGap: "4" },
		},
		regular: { parts: { panel: { paddingX: "6", paddingY: "6" }, close: { size: "7", radius: "md" } } },
	},
	options: {
		style: {
			default: "panel",
			values: {
				panel: {},
				// Today's floating sheet: 16px in, `rounded-lg`, a ring over `bg-overlay` (the close
				// button and the hidden title are the renderer's).
				card: {
					parts: {
						panel: {
							rowGap: "0",
							paddingX: "4",
							paddingY: "4",
							radius: "lg",
							borderWidth: "none",
							background: "overlay",
							color: "overlay-fg",
							shadow: "sheet-card",
						},
					},
					regular: { parts: { panel: { paddingX: "4", paddingY: "4" } } },
				},
			},
		},
	},
	motion: {
		enter: [
			{ motion: "slideUpIn", part: "panel", regular: "scaleIn" },
			{ motion: "scrimIn", part: "panel", backdrop: true },
		],
	},
})
