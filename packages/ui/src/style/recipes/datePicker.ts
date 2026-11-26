import { defineRecipe } from "../recipe.ts"

/**
 * `hz:datePicker` (phase 4): the kit's date stack (`ui/date-picker.ts`): segments, calendar trigger and popover. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A2 fills it from today's kit (lane D reviews).
 */
export const datePicker = defineRecipe<{}, never, "label" | "field" | "trigger" | "description" | "error">({
	primitive: "datePicker",
	parts: {
		label: "part",
		field: "part",
		trigger: { kind: "part", in: "field" },
		description: "part",
		error: "part",
	},
	base: { root: {} },
	options: {},
})
