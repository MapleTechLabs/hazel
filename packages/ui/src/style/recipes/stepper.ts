import { defineRecipe } from "../recipe.ts"

/**
 * `hz:stepper` (phase 4): onboarding's step counter and segments (`page/onboarding/brand-panel.ts`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const stepper = defineRecipe<{}, never, "label" | "track" | "step">({
	primitive: "stepper",
	parts: {
		label: "part",
		track: "part",
		step: { kind: "part", in: "track" },
	},
	base: { root: {} },
	options: {},
})
