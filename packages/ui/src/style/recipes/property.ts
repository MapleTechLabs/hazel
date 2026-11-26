import { defineRecipe } from "../recipe.ts"

/**
 * `hz:property` (phase 4): a label and value row (`page/customers/detail/parts.ts` `property`:
 * `grid min-h-8 grid-cols-[7rem_1fr] items-center gap-2 text-sm`, the label muted). The two columns,
 * and the description under the label, are the web renderer's grid (`structure/property.ts`).
 */
export const property = defineRecipe<{}, never, "label" | "description" | "value">({
	primitive: "property",
	parts: {
		label: "part",
		description: "part",
		value: "part",
	},
	base: {
		root: { minHeight: "8", gap: "2", text: "label", color: "fg" },
		parts: {
			label: { color: "muted-fg", truncate: true },
			description: { text: "caption", color: "muted-fg", opacity: 0.8 },
			value: { layout: "row", align: "center", gap: "2", color: "fg" },
		},
	},
	options: {},
})
