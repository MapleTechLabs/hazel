import { defineRecipe } from "../recipe.ts"
import type { DialogIconTone, DialogSize } from "../schema.ts"

type Part =
	| "panel"
	| "header"
	| "icon"
	| "heading"
	| "title"
	| "description"
	| "close"
	| "content"
	| "actions"
	| "secondaryActions"

/**
 * `hz:dialog` (the kit's `modal.styles.ts` panel and `dialog.styles.ts` parts): a card with an optional
 * icon tile, a title, a muted description, then the content with its footer slots last (placed by the
 * renderer, as are the width, the placement and the close button's position). A destructive title is red.
 */
export const dialog = defineRecipe<
	{ readonly size: DialogSize; readonly iconTone: DialogIconTone },
	never,
	Part
>({
	primitive: "dialog",
	parts: {
		panel: "part",
		header: { kind: "part", in: "panel" },
		icon: { kind: "part", in: "header" },
		heading: { kind: "part", in: "header" },
		title: { kind: "part", in: "heading" },
		description: { kind: "part", in: "heading" },
		close: { kind: "part", in: "panel" },
		content: { kind: "part", in: "panel" },
		actions: { kind: "slot", in: "content" },
		secondaryActions: { kind: "slot", in: "content" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			// The kit's `--gutter` (24px, 32px from `sm`) pads the card; header to body is the gutter less 8.
			panel: {
				layout: "column",
				rowGap: "4",
				paddingX: "6",
				paddingY: "6",
				radius: "2xl",
				background: "overlay",
				color: "overlay-fg",
				shadow: "dialog",
			},
			header: { layout: "column", rowGap: "1" },
			icon: { layout: "row", align: "center", justify: "center", shrink: false, radius: "lg" },
			heading: { layout: "column", rowGap: "1" },
			title: { text: "modalTitle", weight: "semibold", color: "fg" },
			description: { text: "modalText", color: "muted-fg" },
			close: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				radius: "lg",
				color: "fg-2",
				transition: "fast",
			},
			content: { rowGap: "4" },
			// Body to footer is the gutter less 4 (`pt-[calc(var(--gutter)---spacing(2))]` after `py-1`).
			actions: { gap: "3", paddingTop: "1" },
			secondaryActions: { gap: "3", paddingTop: "1" },
		},
		regular: {
			parts: {
				panel: { paddingX: "8", paddingY: "8", rowGap: "6", radius: "xl" },
				close: { size: "7", radius: "md" },
				actions: { paddingTop: "3" },
				secondaryActions: { paddingTop: "3" },
			},
		},
	},
	options: {
		size: {
			default: "regular",
			values: { regular: {}, large: {}, fullscreen: { parts: { panel: { radius: "md" } } } },
		},
		iconTone: {
			default: "accent",
			values: {
				// Beside the title (today's create DM: `size-10 rounded-lg bg-primary-subtle`, a 20px glyph).
				accent: {
					parts: {
						header: { layout: "row", align: "center", gap: "3" },
						icon: { size: "10", background: "primary-subtle", color: "primary" },
					},
				},
				// Above it (today's delete message: `size-12 border-danger/10 bg-danger/5`, a 24px glyph).
				danger: {
					parts: {
						icon: {
							size: "12",
							borderWidth: "hairline",
							borderColor: "danger-tint",
							background: "danger-wash",
							color: "danger",
						},
					},
				},
			},
		},
	},
	states: { destructive: { parts: { title: { color: "danger-subtle-fg" } } } },
	motion: {
		enter: [
			{ motion: "riseIn", part: "panel", regular: "scaleIn" },
			{ motion: "scrimIn", part: "panel", backdrop: true },
		],
	},
})
