import type { Html, HtmlBuilder } from "foldkit/html"
import { dataTable } from "../../../../apps/web-foldkit/src/ui/data-table.ts"

/**
 * The kit side of lane W8's table: today's `dataTable`, unframed as the pages draw it inside a card,
 * with the content of `fixtures/table/kit.json` (a sorted column, the select column, the footer).
 */

type H = HtmlBuilder<never>

interface Account {
	readonly id: string
	readonly name: string
	readonly plan: string
	readonly mrr: string
}

const accounts: ReadonlyArray<Account> = [
	{ id: "acme", name: "Acme", plan: "Pro", mrr: "$12,400" },
	{ id: "globex", name: "Globex", plan: "Team", mrr: "$3,100" },
	{ id: "initech", name: "Initech", plan: "Free", mrr: "$0" },
]

// SAFETY: the gallery never dispatches; Foldkit only needs a message value to bind.
const noMessage = undefined as never

// Last on the page, under today's DM row (80.5px tall on a phone): once the fonts settle, the
// specimen pads back onto whole pixels, or its hairlines raster apart from the fixture's.
const snap = () => {
	const node = document.querySelector<HTMLElement>('[data-specimen="data-table"]')
	if (node === null) return void requestAnimationFrame(snap)
	const fraction = node.getBoundingClientRect().top % 1
	if (fraction !== 0) node.style.marginTop = `${1 - fraction}px`
}
void document.fonts.ready.then(() => requestAnimationFrame(snap))

export const tableSpecimens = (h: H): Html =>
	h.div(
		[h.Class("frames"), h.Attribute("style", "flex-direction: column; align-items: stretch;")],
		[
			h.div(
				[h.Attribute("style", "max-width: 720px;"), h.Attribute("data-specimen", "data-table")],
				[
					dataTable(h, {
						ariaLabel: "Customers",
						id: "kit-table",
						isFramed: false,
						columns: [
							{
								key: "name",
								label: "Customer",
								sortable: true,
								cell: (row) => h.span([h.Class("font-medium")], [row.name]),
								footer: "3 customers",
							},
							{
								key: "plan",
								label: "Plan",
								widthClass: "w-24",
								hideClass: "max-sm:hidden",
								cell: (row) => h.span([h.Class("text-muted-fg")], [row.plan]),
							},
							{
								key: "mrr",
								label: "MRR",
								align: "right",
								sortable: true,
								widthClass: "w-32",
								cell: (row) => row.mrr,
								footer: "$15,500",
							},
						],
						rows: accounts,
						rowKey: (row) => row.id,
						sort: { key: "mrr", direction: "desc" },
						onSort: () => noMessage,
						selection: {
							selected: new Set(),
							onToggle: () => noMessage,
							onToggleAll: () => noMessage,
							rowLabel: (row) => row.name,
						},
						onRowPress: () => noMessage,
					}),
				],
			),
		],
	)
