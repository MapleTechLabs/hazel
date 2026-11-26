import { defineRecipe } from "../recipe.ts"
import type { BadgeSize, BadgeStyle, BadgeTone } from "../schema.ts"

/**
 * `badge` (`apps/web-foldkit/src/core/components/ui/badge.styles.ts`): intents `secondary`, `primary`,
 * `success`, ... are tones `neutral`, `accent`, ...; `outline` is `neutral` + `outline`, `success-outline`
 * is `success` + `outline`, `muted` is `neutral` + `quiet`; sizes `md`, `sm` are `regular`, `small`;
 * `isPill` is `pill`. The tone sets the fill and ink, the style replaces them.
 */
export const badge = defineRecipe<
	{ readonly tone: BadgeTone; readonly style: BadgeStyle; readonly size: BadgeSize },
	"pill",
	"icon"
>({
	primitive: "badge",
	parts: { icon: "part" },
	base: {
		root: {
			layout: "inline-row",
			align: "center",
			nowrap: true,
			strong: true,
			numeric: true,
			radius: "sm",
			transition: "normal",
		},
		parts: { icon: { shrink: false } },
	},
	options: {
		tone: {
			default: "neutral",
			values: {
				neutral: { root: { background: "secondary", color: "secondary-fg" } },
				accent: { root: { background: "primary-subtle", color: "accent-fg" } },
				success: { root: { background: "success-subtle", color: "success-subtle-fg" } },
				warning: { root: { background: "warning-subtle", color: "warning-subtle-fg" } },
				danger: { root: { background: "danger-subtle", color: "danger-subtle-fg" } },
				info: { root: { background: "info-subtle", color: "info-subtle-fg" } },
			},
		},
		style: {
			default: "solid",
			values: {
				solid: {},
				outline: { root: { background: "transparent", ring: "border" } },
				quiet: { root: { background: "secondary", color: "muted-fg" } },
			},
		},
		size: {
			default: "regular",
			values: {
				regular: {
					root: { gap: "1.5", paddingX: "1.5", paddingY: "0.5", text: "caption", leading: "5" },
					parts: { icon: { size: "3" } },
				},
				small: {
					root: { gap: "1", paddingX: "1", paddingY: "px", text: "micro" },
					parts: { icon: { size: "2.5" } },
				},
			},
		},
	},
	flags: { pill: { root: { radius: "lg" } } },
	compounds: [
		{ when: { pill: true, size: "regular" }, style: { root: { paddingX: "2" } } },
		{ when: { pill: true, size: "small" }, style: { root: { paddingX: "1.5" } } },
	],
})
