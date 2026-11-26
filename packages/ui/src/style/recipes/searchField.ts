import { defineRecipe } from "../recipe.ts"

/** `searchField` (`search-field.styles.ts`): a leading search icon in the field's fill. */
export const searchField = defineRecipe<{}, never, "icon" | "input">({
	primitive: "searchField",
	parts: { icon: "part", input: "part" },
	base: {
		root: {
			layout: "row",
			align: "center",
			fill: true,
			gap: "2",
			radius: "lg",
			background: "secondary",
			paddingX: { step: "3", lessBorder: true },
			transition: "fast",
		},
		parts: {
			icon: { size: "5", color: "muted-fg", shrink: false },
			input: {
				grow: true,
				color: "fg",
				text: "body",
				background: "transparent",
				paddingY: { step: "2.5", lessBorder: true },
			},
		},
		regular: {
			root: { paddingX: { step: "2.5", lessBorder: true } },
			parts: {
				icon: { size: "4" },
				input: { paddingY: { step: "1.5", lessBorder: true }, leading: "6" },
			},
		},
		states: { hover: { root: { background: "secondary-hover" } } },
	},
	options: {},
})
