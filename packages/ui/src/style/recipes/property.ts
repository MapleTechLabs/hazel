import { defineRecipe } from "../recipe.ts"
import type { PropertyStyle } from "../schema.ts"

/**
 * `hz:property` (phase 4): a label and value row (`page/customers/detail/parts.ts` `property`:
 * `grid min-h-8 grid-cols-[7rem_1fr] items-center gap-2 text-sm`, the label muted). The two columns,
 * and the description under the label, are the web renderer's grid (`structure/property.ts`).
 * `justified` is customers' fact row (`evidence.ts` `fact`: `flex items-baseline justify-between
 * gap-4 text-sm`, the value `text-right tabular-nums`).
 */
export const property = defineRecipe<
	{ readonly style: PropertyStyle },
	never,
	"label" | "description" | "value"
>({
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
	options: {
		style: {
			default: "column",
			values: {
				column: {},
				justified: {
					root: { minHeight: "0", gap: "4" },
					parts: { label: { truncate: false }, value: { numeric: true } },
				},
			},
		},
	},
})
