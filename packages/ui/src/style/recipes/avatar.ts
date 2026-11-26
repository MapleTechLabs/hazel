import { defineRecipe } from "../recipe.ts"

/** `avatar`: initials in a filled circle, sized like the icon it stands beside. */
export const avatar = defineRecipe<{}, never, never>({
	primitive: "avatar",
	parts: {},
	base: {
		root: {
			layout: "row",
			align: "center",
			justify: "center",
			size: "5",
			radius: "full",
			background: "primary",
			color: "primary-fg",
			text: "micro",
			strong: true,
			shrink: false,
		},
		regular: { root: { size: "4" } },
	},
	options: {},
})
