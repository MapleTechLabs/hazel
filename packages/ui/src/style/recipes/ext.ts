import { defineRecipe } from "../recipe.ts"

/**
 * An extension's placeholder (`hz:ext`): `surface` holds the platform's drawing, `content` the
 * fallback slot. The host hides whichever one is not in use.
 */
export const ext = defineRecipe<{}, never, "surface" | "content">({
	primitive: "ext",
	parts: { surface: "part", content: "part" },
	base: {
		root: { marginX: "4", marginBottom: "3" },
		parts: { content: { paddingX: "3", paddingY: "2.5", radius: "lg", ring: "border" } },
	},
	options: {},
})
