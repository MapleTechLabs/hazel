import { defineRecipe } from "../recipe.ts"
import type { IconTileTone } from "../schema.ts"

/**
 * `hz:iconTile` (`ui/icon-tile.ts`, size `md`): a glyph on a tinted square, `size-10 rounded-lg border`,
 * the glyph `size-5`. Tones are the kit's intents (`accent` is its `primary`).
 */
export const iconTile = defineRecipe<{ readonly tone: IconTileTone }, never, "icon">({
	primitive: "iconTile",
	parts: { icon: "part" },
	base: {
		root: {
			layout: "row",
			align: "center",
			justify: "center",
			size: "10",
			radius: "lg",
			borderWidth: "hairline",
			shrink: false,
		},
		parts: { icon: { size: "5" } },
	},
	options: {
		tone: {
			default: "neutral",
			values: {
				neutral: { root: { borderColor: "border", background: "secondary", color: "muted-fg" } },
				// HAZEL-GAP(icon-tile-tints): the kit fills `bg-primary/5`; nearest token is `/10`.
				accent: {
					root: { borderColor: "primary-tint", background: "primary-tint", color: "primary" },
				},
				// HAZEL-GAP(icon-tile-tints): the kit fills `bg-danger/5`; nearest token is `/10`.
				danger: { root: { borderColor: "danger-tint", background: "danger-tint", color: "danger" } },
				// HAZEL-GAP(icon-tile-tints): the kit's edge is `border-warning/20`; nearest is `/10`.
				warning: {
					root: {
						borderColor: "warning-tint",
						background: "warning-subtle",
						color: "warning-subtle-fg",
					},
				},
				// HAZEL-GAP(icon-tile-tints): the kit's edge is `border-success/20`; nearest is the fill.
				success: {
					root: {
						borderColor: "success-subtle",
						background: "success-subtle",
						color: "success-subtle-fg",
					},
				},
			},
		},
	},
})
