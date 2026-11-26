import { defineRecipe } from "../recipe.ts"

/**
 * `hz:table` (phase 4): the data table (`ui/data-table.ts`): head row, sort marks, checkbox column, skeleton rows. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const table = defineRecipe<
	{},
	never,
	"head" | "headCell" | "sortMark" | "body" | "selectCell" | "skeleton"
>({
	primitive: "table",
	parts: {
		head: "part",
		headCell: { kind: "part", in: "head" },
		sortMark: { kind: "part", in: "headCell" },
		body: "part",
		selectCell: "part",
		skeleton: "part",
	},
	base: { root: {} },
	options: {},
})
