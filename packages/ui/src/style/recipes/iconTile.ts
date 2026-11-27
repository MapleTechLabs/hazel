import { defineRecipe } from "../recipe.ts"
import type { IconTileSize, IconTileTone } from "../schema.ts"

/**
 * `hz:iconTile` (`ui/icon-tile.ts`, size `md`): a glyph on a tinted square, `size-10 rounded-lg border`,
 * the glyph `size-5`. Tones are the kit's intents (`accent` is its `primary`). Phase 4: `mark` and the
 * smaller sizes are customers' `sourceMark` (`rounded-lg bg-secondary`, `xsmall` `rounded-md`), whose
 * `image` (`rounded-sm object-contain`) takes the glyph's place at 24, 20 and 16pt.
 */
export const iconTile = defineRecipe<
	{ readonly tone: IconTileTone; readonly size: IconTileSize },
	never,
	"icon"
>({
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
		parts: { icon: { size: "5", radius: "sm" } },
	},
	options: {
		tone: {
			default: "neutral",
			values: {
				neutral: { root: { borderColor: "border", background: "secondary", color: "muted-fg" } },
				accent: {
					root: { borderColor: "primary-tint", background: "primary-wash", color: "primary" },
				},
				danger: { root: { borderColor: "danger-tint", background: "danger-wash", color: "danger" } },
				warning: {
					root: {
						borderColor: "warning-edge",
						background: "warning-subtle",
						color: "warning-subtle-fg",
					},
				},
				success: {
					root: {
						borderColor: "success-edge",
						background: "success-subtle",
						color: "success-subtle-fg",
					},
				},
				mark: { root: { borderWidth: "none", background: "secondary", color: "muted-fg" } },
			},
		},
		size: {
			default: "regular",
			values: {
				regular: {},
				small: { root: { size: "8" } },
				xsmall: { root: { size: "6", radius: "md" }, parts: { icon: { size: "4" } } },
			},
		},
	},
})
