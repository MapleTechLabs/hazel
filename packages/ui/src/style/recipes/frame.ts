import { defineRecipe } from "../recipe.ts"
import type { FrameSurface } from "../schema.ts"

/**
 * `hz:frame` (`card.styles.ts`): a box that spaces its children as a column. `card` is the settings
 * card (`rounded-xl border bg-bg shadow-xs`, `p-4`, `p-6` from the regular size class); `danger` the
 * danger zone (`border-danger/20`; the kit's `bg-danger/5` wash has no token yet, so it stays clear);
 * `muted` a quiet bar (the unread bar); `inset` a hairline well; `overlay` a floating panel's
 * contents (no box: the popover is the panel).
 */
export const frame = defineRecipe<{ readonly surface: FrameSurface }, never, "footer">({
	primitive: "frame",
	// `footer`: `items-center gap-4 border-t pt-4`; its hairline, end and `justify-between` are the renderer's.
	parts: { footer: "slot" },
	base: {
		root: { layout: "column", rowGap: "4" },
		parts: { footer: { layout: "row", align: "center", gap: "4", paddingTop: "4" } },
	},
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
				tile: {
					root: {
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "border",
						background: "bg",
						shadow: "xs",
						paddingX: "4",
						paddingY: "4",
					},
					regular: { root: { paddingX: "5", paddingY: "5" } },
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
				// One line in a list of hairline rows (a customer's feature flag, `min-h-8 px-3 py-1`).
				row: {
					root: {
						justify: "center",
						rowGap: "1",
						minHeight: "8",
						radius: "lg",
						ring: "border",
						paddingX: "3",
						paddingY: "1",
					},
				},
				// The card with no padding: its dividers run edge to edge (`frame-flush`, the inbox's card).
				flush: {
					root: {
						rowGap: "0",
						radius: "xl",
						borderWidth: "hairline",
						borderColor: "border",
						background: "bg",
						shadow: "xs",
					},
				},
				// The channel sidebar's tip (`create-channel-hint.ts`): `mx-2 mb-1 rounded-md bg-secondary/50
				// px-2.5 py-1.5`; its icon, key cap and close button are the renderer's.
				hint: {
					root: {
						rowGap: "2",
						marginX: "2",
						marginBottom: "1",
						radius: "md",
						background: "secondary-half",
						paddingX: "2.5",
						paddingY: "1.5",
					},
				},
				// A floating panel's contents: the popover or sheet around it is the panel (its edge,
				// ground and padding), so this draws no box of its own, only the panel's `gap-2` rhythm.
				overlay: { root: { rowGap: "2" } },
			},
		},
	},
})
