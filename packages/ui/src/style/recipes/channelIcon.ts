import { defineRecipe } from "../recipe.ts"

/** `hz:channelIcon`: a phase 1.5 stub; lane A1 fills it with the primitive, lane D reviews it. */
export const channelIcon = defineRecipe<{}, never, never>({
	primitive: "channelIcon",
	parts: {},
	base: { root: {} },
	options: {},
})
