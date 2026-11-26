import { defineRecipe } from "../recipe.ts"

/**
 * `hz:progress` (`progress-bar.styles.ts`): an optional label over a `h-1.5` rounded track in
 * `bg-secondary` with a `bg-primary` fill. The fill's width (from `value`) and the indeterminate
 * slide are the web renderer's; `flex-1` in a row like a spacer.
 */
export const progress = defineRecipe<{}, never, "label" | "track" | "fill">({
	primitive: "progress",
	parts: { label: "part", track: "part", fill: { kind: "part", in: "track" } },
	base: {
		root: { layout: "column", rowGap: "2", grow: true, shrink: true, fill: true },
		parts: {
			label: { text: "label", strong: true, color: "fg", truncate: true },
			track: { fill: true, minHeight: "1.5", radius: "full", background: "secondary" },
			fill: { minHeight: "1.5", radius: "full", background: "primary" },
		},
	},
	options: {},
	motion: {
		loop: [{ motion: "progressSweep", part: "fill" }],
	},
})
