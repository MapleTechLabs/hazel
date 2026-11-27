import type { BadgeTone } from "../schema.ts"
import { defineRecipe } from "../recipe.ts"

/**
 * `hz:toast`: a card with a title (inked by `tone`), a muted description, its action and a close button;
 * a `loading` toast leads with a spinner.
 */
export const toast = defineRecipe<
	{ readonly tone: BadgeTone },
	never,
	"panel" | "spinner" | "body" | "title" | "description" | "content" | "close"
>({
	primitive: "toast",
	parts: {
		panel: "part",
		spinner: { kind: "part", in: "panel" },
		body: { kind: "part", in: "panel" },
		title: { kind: "part", in: "body" },
		description: { kind: "part", in: "body" },
		content: { kind: "part", in: "panel" },
		close: { kind: "part", in: "panel" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				layout: "row",
				gap: "3",
				paddingX: "4",
				paddingY: "3",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				shadow: "overlay",
			},
			// Today's loading icon (`toast.styles.ts` `icon`, kind `loading`): 16px in the quiet ink.
			spinner: { size: "4", shrink: false, color: "fg-2" },
			body: { layout: "column", rowGap: "0.5" },
			title: { text: "label", strong: true },
			description: { text: "caption", color: "muted-fg" },
			content: { layout: "row", align: "center", gap: "2" },
			close: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "6",
				radius: "md",
				color: "muted-fg",
				shrink: false,
			},
		},
	},
	options: {
		tone: {
			default: "neutral",
			values: {
				neutral: {},
				accent: { parts: { title: { color: "accent-fg" } } },
				success: { parts: { title: { color: "success-subtle-fg" } } },
				warning: { parts: { title: { color: "warning-subtle-fg" } } },
				danger: { parts: { title: { color: "danger-subtle-fg" } } },
				info: { parts: { title: { color: "info-subtle-fg" } } },
			},
		},
	},
	motion: {
		enter: [{ motion: "toastIn", part: "panel" }],
		exit: [{ motion: "toastOut", part: "panel" }],
	},
})
