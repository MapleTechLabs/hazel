import { defineRecipe } from "../recipe.ts"
import type { BadgeSeverity, BadgeSize, BadgeStyle, BadgeTone } from "../schema.ts"

/**
 * `badge` (`apps/web-foldkit/src/core/components/ui/badge.styles.ts`): intents `secondary`, `primary`,
 * `success`, ... are tones `neutral`, `accent`, ...; `outline` is `neutral` + `outline`, `success-outline`
 * is `success` + `outline`, `muted` is `neutral` + `quiet`; sizes `md`, `sm` are `regular`, `small`;
 * `isPill` is `pill`. The tone sets the fill and ink, the style replaces them. Phase 4 (PK0): the
 * `icon` part holds a glyph, a mark's picture or the severity bars (drawn by the renderer in the
 * `severity-*` tokens); `detail` is today's `font-normal opacity-80` run; `truncate` is `max-w-32`.
 */
export const badge = defineRecipe<
	{
		readonly tone: BadgeTone
		readonly style: BadgeStyle
		readonly size: BadgeSize
		readonly severity: BadgeSeverity
	},
	"pill" | "truncate",
	"icon" | "label" | "detail"
>({
	primitive: "badge",
	parts: { icon: "part", label: "part", detail: "part" },
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
		parts: {
			icon: { shrink: false },
			label: { minWidth: "0" },
			detail: { strong: false, opacity: 0.8 },
		},
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
				quietOutline: { root: { background: "transparent", ring: "border", color: "muted-fg" } },
				// `signalCounts`: no chip; its metrics are a compound, over the size's.
				plain: { root: { background: "transparent", color: "fg" } },
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
				// `sourceChip`: `h-7 gap-1.5 rounded-md border pr-2 pl-1.5 text-xs`, the mark `size-4`.
				large: {
					root: {
						gap: "1.5",
						paddingX: "2",
						paddingStart: "1.5",
						minHeight: "7",
						text: "caption",
						radius: "md",
					},
					parts: { icon: { size: "4", radius: "sm" } },
				},
			},
		},
		severity: { default: "none", values: { none: {}, low: {}, medium: {}, high: {} } },
	},
	flags: {
		pill: { root: { radius: "lg" } },
		truncate: { root: { shrink: true, minWidth: "0" }, parts: { label: { truncate: true } } },
	},
	compounds: [
		{ when: { pill: true, size: "regular" }, style: { root: { paddingX: "2" } } },
		{ when: { pill: true, size: "small" }, style: { root: { paddingX: "1.5" } } },
		// `signalCounts`: `text-sm tabular-nums`, glyph and count `gap-1`; an opportunity in its tone's ink.
		{
			when: { style: "plain" },
			style: {
				root: {
					paddingX: "0",
					paddingY: "0",
					gap: "1",
					text: "label",
					leading: "5",
					strong: false,
					radius: "none",
				},
			},
		},
		{ when: { style: "plain", tone: "info" }, style: { root: { color: "info-subtle-fg" } } },
		// `kindChip` and `stageBadge` tighten the kit's gap (`gap-x-1`).
		{ when: { style: "solid", size: "regular" }, style: { root: { gap: "1" } } },
		// `sourceChip` and `severityChip` set `text-fg` on the outline.
		{ when: { style: "outline", size: "large" }, style: { root: { color: "fg" } } },
		{ when: { style: "outline", severity: "low" }, style: { root: { color: "fg" } } },
		{ when: { style: "outline", severity: "medium" }, style: { root: { color: "fg" } } },
		{ when: { style: "outline", severity: "high" }, style: { root: { color: "fg" } } },
	],
})
