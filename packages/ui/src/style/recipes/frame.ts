import { defineRecipe } from "../recipe.ts"
import type { FrameSurface } from "../schema.ts"

/**
 * `hz:frame` (`card.styles.ts`): a box that spaces its children as a column. `card` is the settings
 * card (`rounded-xl border bg-bg shadow-xs`, `p-4`, `p-6` from the regular size class); `danger` the
 * danger zone (`border-danger/20`; the kit's `bg-danger/5` wash has no token yet, so it stays clear);
 * `muted` a quiet bar (the unread bar); `inset` a hairline well; `overlay` a floating panel.
 */
export const frame = defineRecipe<{ readonly surface: FrameSurface }, never, never>({
	primitive: "frame",
	parts: {},
	base: { root: { layout: "column", rowGap: "4" } },
	options: {
		surface: {
			default: "card",
			values: {
				none: {},
				card: {
					root: {
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "border",
						background: "bg",
						shadow: "xs",
						paddingX: "4",
						paddingY: "4",
					},
					regular: { root: { paddingX: "6", paddingY: "6" } },
				},
				danger: {
					root: {
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "danger-subtle",
						paddingX: "4",
						paddingY: "4",
					},
					regular: { root: { paddingX: "6", paddingY: "6" } },
				},
				muted: {
					root: { rowGap: "2", radius: "lg", background: "muted", paddingX: "3", paddingY: "1.5" },
				},
				inset: {
					root: { rowGap: "3", radius: "lg", ring: "border", paddingX: "3", paddingY: "2.5" },
				},
				// A bordered box with no padding or shadow; its dividers run edge to edge (`frame-flush`).
				flush: {
					root: {
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "border",
						background: "bg",
					},
				},
				overlay: {
					root: {
						rowGap: "2",
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "border",
						background: "bg",
						shadow: "xs",
						paddingX: "3",
						paddingY: "3",
					},
				},
			},
		},
	},
})
