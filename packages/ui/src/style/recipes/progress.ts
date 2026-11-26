import { defineRecipe } from "../recipe.ts"
import type { ProgressStyle } from "../schema.ts"

/**
 * `hz:progress` (`progress-bar.styles.ts`): an optional label over a `h-1.5` rounded track in
 * `bg-secondary` with a `bg-primary` fill. The fill's width (from `value`) and the indeterminate
 * slide are the web renderer's; `flex-1` in a row like a spacer. `spinner` is the kit's loader
 * (`ui/loader.ts`, `size-4`, the page's ink) before its label, as `loadingState` (`gap-3 text-sm
 * text-muted-fg`); the spinner's twelve strokes and their rotation are the renderer's SVG.
 */
export const progress = defineRecipe<
	{ readonly style: ProgressStyle },
	never,
	"label" | "track" | "fill" | "spinner"
>({
	primitive: "progress",
	parts: { label: "part", track: "part", fill: { kind: "part", in: "track" }, spinner: "part" },
	base: {
		root: { layout: "column", rowGap: "2" },
		parts: {
			label: { text: "label", strong: true, color: "fg", truncate: true },
			track: { fill: true, minHeight: "1.5", radius: "full", background: "secondary" },
			fill: { minHeight: "1.5", radius: "full", background: "primary" },
			spinner: { size: "4", shrink: false },
		},
	},
	options: {
		style: {
			default: "bar",
			values: {
				bar: { root: { grow: true, shrink: true, fill: true } },
				spinner: {
					root: { layout: "row", align: "center", gap: "3", shrink: false },
					parts: { label: { strong: false, color: "muted-fg" } },
				},
			},
		},
	},
	motion: {
		loop: [{ motion: "progressSweep", part: "fill" }],
	},
})
