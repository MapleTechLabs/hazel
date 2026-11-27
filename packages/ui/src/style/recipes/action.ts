import { defineRecipe } from "../recipe.ts"

/** A section's header action (`hz:action`): a quiet square button around an icon. */
export const action = defineRecipe<{}, never, "icon">({
	primitive: "action",
	parts: { icon: "children" },
	base: {
		root: {
			layout: "row",
			align: "center",
			justify: "center",
			size: "8",
			radius: "lg",
			color: "sidebar-title",
			shrink: false,
			transition: "fast",
		},
		parts: { icon: { size: "3.5" } },
		states: {
			hover: { root: { background: "wash", color: "fg" } },
			pressed: { root: { background: "wash", color: "fg" } },
		},
	},
	options: {},
})
