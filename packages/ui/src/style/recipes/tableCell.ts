import { defineRecipe } from "../recipe.ts"

/**
 * `hz:tableCell` (phase 4): a data table cell (`ui/data-table.ts`): `px-3 text-fg text-sm
 * tabular-nums`. Its height, alignment and width by column are the web renderer's.
 */
export const tableCell = defineRecipe<{}, never, never>({
	primitive: "tableCell",
	parts: {},
	base: { root: { paddingX: "3", text: "label", color: "fg", numeric: true } },
	options: {},
})
