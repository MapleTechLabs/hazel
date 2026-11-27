import { defineRecipe } from "../recipe.ts"

/**
 * `hz:stepper` (phase 4): onboarding's step counter (`page/onboarding/view.ts` `stepCounter`:
 * `font-mono text-sm`, "Step 2 of 6") over a track of segments, one per step. Which segments are
 * done is the web renderer's (`structure/stepper.ts`, `data-done` on a step).
 */
export const stepper = defineRecipe<{}, never, "label" | "track" | "step">({
	primitive: "stepper",
	parts: {
		label: "part",
		track: "part",
		step: { kind: "part", in: "track" },
	},
	base: {
		root: { layout: "column", rowGap: "2" },
		parts: {
			label: { text: "code", color: "muted-fg", numeric: true },
			track: { layout: "row", gap: "1", fill: true },
			step: {
				minHeight: "1",
				grow: true,
				radius: "full",
				background: "secondary",
				transition: "normal",
			},
		},
	},
	options: {},
})
