import { defineRecipe } from "../recipe.ts"
import type { LinkTone } from "../schema.ts"

/**
 * `link` (`link.styles.ts`): medium weight in the accent ink; the control is an `a` or a `button`.
 * `inline` sits inside a line of text. `muted` is channel settings' way back (`text-muted-fg text-sm hover:text-fg`, a 16px arrow, `gap-2`).
 */
export const link = defineRecipe<{ readonly tone: LinkTone }, never, "control" | "icon">({
	primitive: "link",
	parts: { control: "part", icon: { kind: "part", in: "control" } },
	base: {
		root: { layout: "inline-row" },
		parts: {
			control: { color: "accent-fg", strong: true, transition: "fast" },
			icon: { size: "4", shrink: false },
		},
		states: { hover: { parts: { control: { color: "fg" } } } },
	},
	options: {
		tone: {
			default: "accent",
			values: {
				accent: {},
				// A link inside a sentence (sign-in's `New to Hazel? Create an account`): the sentence's
				// size and weight in `fg` ink, `underline underline-offset-2` (the renderer's).
				inline: { parts: { control: { color: "fg", strong: false } } },
				muted: {
					parts: {
						control: {
							layout: "inline-row",
							align: "center",
							gap: "2",
							color: "muted-fg",
							strong: false,
							text: "label",
						},
					},
				},
			},
		},
	},
})
