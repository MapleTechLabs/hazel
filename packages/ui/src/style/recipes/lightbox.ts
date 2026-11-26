import { defineRecipe } from "../recipe.ts"

/**
 * `hz:lightbox` (phase 4): the image and video viewer (`chat/image-viewer.ts`): stage, thumbnail strip, toolbar. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A3 fills it from today's kit (lane D reviews).
 */
export const lightbox = defineRecipe<{}, never, "stage" | "strip" | "toolbar">({
	primitive: "lightbox",
	parts: {
		stage: "part",
		strip: "part",
		toolbar: "part",
	},
	base: { root: {} },
	options: {},
})
