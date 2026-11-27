import { defineRecipe } from "../recipe.ts"
import type { TableFrame, TableRowActions } from "../schema.ts"

/**
 * `hz:table` (phase 4): today's data table (`ui/data-table.ts`): column heads `h-9` in muted 12px
 * medium over a hairline, a sort control with its chevron well, the select column (`w-10 pl-4`) and
 * pulsing skeleton bars. Column widths, alignment, sticky heads, hairlines between rows and the
 * compact columns are the web renderer's (`list/table-shared.ts`).
 */
export const table = defineRecipe<
	{ readonly frame: TableFrame; readonly rowActions: TableRowActions },
	"selectable" | "loading" | "stickyHeader",
	| "grid"
	| "head"
	| "headRow"
	| "headCell"
	| "sortLine"
	| "sort"
	| "sortMark"
	| "body"
	| "selectCell"
	| "skeleton"
	| "skeletonRow"
	| "skeletonCell"
	| "skeletonBar"
>({
	primitive: "table",
	parts: {
		grid: "part",
		head: { kind: "part", in: "grid" },
		headRow: { kind: "part", in: "head" },
		headCell: { kind: "part", in: "headRow" },
		sortLine: { kind: "part", in: "headCell" },
		sort: { kind: "part", in: "sortLine" },
		sortMark: { kind: "part", in: "sort" },
		body: { kind: "part", in: "grid" },
		selectCell: { kind: "part", in: "headRow" },
		skeleton: { kind: "part", in: "grid" },
		skeletonRow: { kind: "part", in: "skeleton" },
		skeletonCell: { kind: "part", in: "skeletonRow" },
		skeletonBar: { kind: "part", in: "skeletonCell" },
	},
	base: {
		root: { fill: true },
		parts: {
			grid: { fill: true },
			// `tableHeadClass`: `h-9 whitespace-nowrap font-medium text-muted-fg text-xs`, `border-b`.
			headCell: {
				paddingX: "3",
				text: "caption",
				strong: true,
				color: "muted-fg",
				nowrap: true,
				divider: "border",
			},
			// `inline-flex items-center gap-1 rounded`; the mark a `size-4` well, filled while sorted.
			sort: { layout: "inline-row", align: "center", gap: "1", radius: "sm", transition: "fast" },
			sortMark: {
				layout: "inline-row",
				align: "center",
				justify: "center",
				size: "4",
				radius: "sm",
				background: "secondary",
				color: "fg",
			},
			selectCell: { paddingStart: "4", divider: "border" },
			skeletonCell: { paddingX: "3" },
			skeletonBar: { radius: "sm", background: "secondary" },
		},
	},
	options: {
		// `card`: today's framed `dataTable` (`rounded-xl border border-border`); `band`'s top and bottom
		// hairlines (`rounded-none border-x-0`) are the renderer's, as `Declarations` draw all four edges.
		frame: {
			default: "none",
			values: {
				none: {},
				card: { root: { borderWidth: "hairline", borderColor: "border", radius: "xl" } },
				band: {},
			},
		},
		// Where hover actions sit is the renderer's (`list/table-shared.ts`).
		rowActions: { default: "lastCell", values: { lastCell: {}, trailing: {} } },
	},
	flags: { selectable: {}, loading: {}, stickyHeader: {} },
	motion: {
		enter: [{ motion: "skeletonIn", part: "skeleton" }],
		loop: [{ motion: "skeletonPulse", part: "skeletonBar" }],
	},
})
