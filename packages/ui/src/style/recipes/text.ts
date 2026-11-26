import { defineRecipe } from "../recipe.ts"
import type { TextRole, TextTone } from "../schema.ts"

/**
 * `text`: a role's type, a tone's ink, and `strong`, the one weight choice a view has. `numeric` sets
 * tabular figures (counts, times), `truncate` ends one line with an ellipsis.
 */
export const text = defineRecipe<
	{ readonly role: TextRole; readonly tone: TextTone },
	"strong" | "numeric" | "truncate"
>({
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
				// heading.styles.ts `label`: `font-medium text-fg-2 text-xs uppercase tracking-wider`.
				// Its ink is the `subtle` tone (`fg-2`), which the view sets.
				overline: { root: { text: "overline", uppercase: true, strong: true } },
				// kbd.styles.ts `md`: a raised key cap inside a line of text.
				kbd: {
					root: {
						text: "kbd",
						layout: "inline-row",
						align: "center",
						justify: "center",
						nowrap: true,
						strong: true,
						background: "bg",
						borderWidth: "hairline",
						borderColor: "border",
						radius: "sm",
						shadow: "xs",
						paddingX: "1.5",
						minHeight: "5.5",
					},
				},
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
	flags: {
		strong: { root: { strong: true } },
		numeric: { root: { numeric: true } },
		truncate: { root: { truncate: true } },
	},
	// A key cap's default ink is `fg-3`, under the tone layer.
	compounds: [{ when: { role: "kbd", tone: "default" }, style: { root: { color: "fg-3" } } }],
})
