import { defineRecipe } from "../recipe.ts"

/** `hz:emojiPicker`: a phase 1.5 stub; lane A3 fills it with the primitive, lane D reviews it. */
export const emojiPicker = defineRecipe<{}, never, never>({
	primitive: "emojiPicker",
	parts: {},
	base: { root: {} },
	options: {},
})
