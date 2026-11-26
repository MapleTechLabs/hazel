import { defineRecipe } from "../recipe.ts"

/**
 * `hz:slider` (phase 4): the kit's slider (`ui/slider.ts`): label, value text, track, fill and thumb. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A2 fills it from today's kit (lane D reviews).
 */
export const slider = defineRecipe<{}, never, "label" | "value" | "track" | "fill" | "thumb">({
	primitive: "slider",
	parts: {
		label: "part",
		value: "part",
		track: "part",
		fill: { kind: "part", in: "track" },
		thumb: { kind: "part", in: "track" },
	},
	base: { root: {} },
	options: {},
})
