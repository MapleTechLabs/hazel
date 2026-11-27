import { defineRecipe } from "../recipe.ts"

/**
 * `hz:image`: a picture at its own aspect ratio (`width` and `height` reserve the box before it loads),
 * on a muted plate with the kit's `rounded-lg`.
 */
export const image = defineRecipe<{}, never, never>({
	primitive: "image",
	parts: {},
	base: { root: { radius: "lg", background: "muted", shrink: false } },
	options: {},
})
