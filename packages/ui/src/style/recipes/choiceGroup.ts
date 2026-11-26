import { defineRecipe } from "../recipe.ts"
import type { ChoiceStyle } from "../schema.ts"

/**
 * `hz:choiceGroup` (phase 4): radio rows, choice cards, segmented control, chips and swatches (`ui/radio.ts`, `choice-box.ts`, `segmented-control.ts`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A2 fills it from today's kit (lane D reviews).
 */
export const choiceGroup = defineRecipe<
	{ readonly style: ChoiceStyle; readonly columns: "1" | "2" | "3" },
	never,
	"label" | "description" | "options" | "option" | "indicator" | "error"
>({
	primitive: "choiceGroup",
	parts: {
		label: "part",
		description: "part",
		options: "part",
		option: { kind: "part", in: "options" },
		indicator: { kind: "part", in: "option" },
		error: "part",
	},
	base: { root: {} },
	options: {
		style: {
			default: "list",
			values: { list: {}, cards: {}, segmented: {}, chips: {}, swatches: {} },
		},
		columns: {
			default: "1",
			values: { "1": {}, "2": {}, "3": {} },
		},
	},
})
