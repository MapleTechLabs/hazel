import { defineRecipe } from "../recipe.ts"

/** `link` (`link.styles.ts`): medium weight in the accent ink; the control is an `a` or a `button`. */
export const link = defineRecipe<{}, never, "control">({
	primitive: "link",
	parts: { control: "part" },
	base: {
		root: { layout: "inline-row" },
		parts: { control: { color: "accent-fg", strong: true, transition: "fast" } },
		states: { hover: { parts: { control: { color: "fg" } } } },
	},
	options: {},
})
