import { defineRecipe } from "../recipe.ts"
import type { BadgeTone, BannerStyle } from "../schema.ts"

/**
 * `hz:banner` (phase 4). `callout` is the kit's callout (`ui/callout.ts`): `flex gap-3 rounded-lg
 * border p-3 text-sm` in the tone's tint, the glyph `mt-0.5 size-4`, then a `gap-1` column of the
 * title (`font-medium`), the description (`opacity-90`), the children and the actions (`mt-2 gap-2`).
 * `bar` is the chat's new-messages band (`channel/view.ts`): `mx-3 h-7 rounded-b-lg text-xs
 * shadow-sm`, solid `bg-primary` in `accent`, the title `px-3 font-medium` filling the row.
 */
export const banner = defineRecipe<
	{ readonly tone: BadgeTone; readonly style: BannerStyle },
	never,
	"icon" | "title" | "description" | "content" | "actions" | "dismiss"
>({
	primitive: "banner",
	parts: {
		icon: "part",
		content: "part",
		title: { kind: "part", in: "content" },
		description: { kind: "part", in: "content" },
		actions: { kind: "slot", in: "content" },
		dismiss: "part",
	},
	base: {
		root: { layout: "row", gap: "3", borderWidth: "hairline", text: "label" },
		parts: {
			// `mt-0.5 size-4` as a line-high box: 2px of padding around the glyph, bled out sideways.
			icon: { size: "5", paddingX: "0.5", paddingY: "0.5", bleedX: "0.5", shrink: false },
			content: { layout: "column", rowGap: "1", grow: true, shrink: true, minWidth: "0" },
			title: { strong: true },
			description: { opacity: 0.9 },
			actions: { layout: "row", wrap: true, align: "center", gap: "2", paddingTop: "2" },
			dismiss: {
				size: "5",
				paddingX: "0.5",
				paddingY: "0.5",
				radius: "sm",
				shrink: false,
				opacity: 0.7,
				transition: "fast",
			},
		},
	},
	options: {
		tone: {
			default: "info",
			values: {
				neutral: { root: { borderColor: "border", background: "secondary", color: "secondary-fg" } },
				accent: {
					root: { borderColor: "primary-tint", background: "primary-subtle", color: "accent-fg" },
				},
				success: {
					root: {
						borderColor: "success-edge",
						background: "success-subtle",
						color: "success-subtle-fg",
					},
				},
				warning: {
					root: {
						borderColor: "warning-edge",
						background: "warning-subtle",
						color: "warning-subtle-fg",
					},
				},
				danger: {
					root: {
						borderColor: "danger-edge",
						background: "danger-subtle",
						color: "danger-subtle-fg",
					},
				},
				info: {
					root: { borderColor: "info-edge", background: "info-subtle", color: "info-subtle-fg" },
				},
			},
		},
		style: {
			default: "callout",
			values: {
				callout: { root: { radius: "lg", paddingX: "3", paddingY: "3" } },
				bar: {
					root: {
						align: "center",
						gap: "0",
						minHeight: "7",
						marginX: "3",
						radius: "lg",
						borderWidth: "none",
						text: "caption",
						shadow: "sm",
						shrink: false,
					},
					parts: {
						content: { layout: "row", align: "center", gap: "0", rowGap: "0" },
						title: { paddingX: "3", grow: true, truncate: true },
						actions: { wrap: false, gap: "0", paddingTop: "0" },
						dismiss: { marginX: "1" },
					},
				},
			},
		},
	},
	compounds: [
		{
			when: { style: "bar", tone: "accent" },
			style: { root: { background: "primary", color: "primary-fg" } },
		},
	],
})
