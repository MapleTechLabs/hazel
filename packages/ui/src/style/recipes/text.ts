import { defineRecipe } from "../recipe.ts"
import type { TextRole, TextTone } from "../schema.ts"

/** `text`: a role's type, a tone's ink, and `strong`, the one weight choice a view has. */
export const text = defineRecipe<{ readonly role: TextRole; readonly tone: TextTone }, "strong">({
	primitive: "text",
	parts: {},
	base: { root: { strong: false } },
	options: {
		role: {
			default: "body",
			values: {
				body: { root: { text: "body" } },
				label: { root: { text: "label" } },
				caption: { root: { text: "caption" } },
				title: { root: { text: "title" } },
				display: { root: { text: "display" } },
				code: { root: { text: "code" } },
			},
		},
		tone: {
			default: "default",
			values: {
				default: { root: { color: "fg" } },
				muted: { root: { color: "muted-fg" } },
				subtle: { root: { color: "fg-2" } },
				accent: { root: { color: "accent-fg" } },
				success: { root: { color: "success-subtle-fg" } },
				warning: { root: { color: "warning-subtle-fg" } },
				danger: { root: { color: "danger-subtle-fg" } },
				info: { root: { color: "info-subtle-fg" } },
			},
		},
	},
	flags: { strong: { root: { strong: true } } },
})
