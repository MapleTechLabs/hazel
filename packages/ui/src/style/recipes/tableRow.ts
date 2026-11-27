import { defineRecipe } from "../recipe.ts"

/**
 * `hz:tableRow` (phase 4): a data table row (`ui/data-table.ts`): a wash on hover and on the keyboard
 * row (`data-focused`), the selected tint, the select column's cell (`w-10 pl-4`), a group heading
 * (`unmatched/table.ts`: `bg-secondary/40 px-4 py-1.5` muted 12px medium) and the footer's wash.
 * Where the actions sit and when they show are the web renderer's.
 */
export const tableRow = defineRecipe<
	{},
	"current" | "group" | "footer",
	"selectCell" | "heading" | "actions"
>({
	primitive: "tableRow",
	parts: {
		selectCell: "part",
		heading: "part",
		actions: "slot",
	},
	base: {
		root: { transition: "fast" },
		parts: {
			selectCell: { paddingStart: "4" },
			heading: {
				paddingX: "4",
				paddingY: "1.5",
				text: "caption",
				strong: true,
				color: "muted-fg",
				background: "secondary-band",
			},
			actions: { layout: "row", align: "center", gap: "1" },
		},
	},
	options: {},
	flags: {
		current: { root: { background: "wash" } },
		group: {},
		footer: { root: { background: "wash" } },
	},
	states: {
		hover: { root: { background: "wash" } },
		// Today's `bg-primary-subtle/40` (`table-selected-wash`).
		selected: { root: { background: "row-selected" } },
		disabled: { root: { opacity: 0.5 } },
	},
	inert: ["selected", "disabled"],
})
