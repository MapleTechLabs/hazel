// Owned by lane A4 (phase 4, W8). `hz:table`: today's data table (`ui/data-table.ts`) as a real
// `<table>`: a head of column headers (sort marks, the select-all checkbox), a body of `tableRow`s and
// skeleton rows while `loading`. The screen sorts and selects; the table marks and reports.
// A selectable table, or one whose rows press, is a `grid` the keyboard moves through by row.
import { svg } from "../../icons.ts"
import { loop, onShow } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Plain, type Primitive } from "../define.ts"
import { fire, rowsOf, textOf } from "./runtime.ts"
import { registerScroller } from "./scroll.ts"
import {
	applyColumn,
	checkbox,
	type ColumnLayout,
	columnTracks,
	ensureTableSheet,
	focusableRows,
	guardRowChecks,
} from "./table-shared.ts"

/** Skeleton rows drawn while `loading` when the view names no `loadingRows` (as the list's). */
const SKELETON_ROWS = 6

const recordOf = (value: Plain): { readonly [key: string]: Plain } | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as { readonly [key: string]: Plain })
		: undefined

const columnsOf = (
	value: Plain,
): ReadonlyArray<ColumnLayout & { readonly label: string; sortable: boolean }> =>
	Array.isArray(value)
		? value.flatMap((input) => {
				const entry = recordOf(input)
				if (entry === undefined) return []
				const key = textOf(entry.key ?? null)
				if (key === "") return []
				return [
					{
						key,
						label: textOf(entry.label ?? null),
						align: entry.align === "end" ? ("end" as const) : ("start" as const),
						width: typeof entry.width === "string" ? entry.width : "auto",
						optional: entry.optional === true,
						sortable: entry.sortable === true,
					},
				]
			})
		: []

const sortOf = (value: Plain) => {
	const sort = recordOf(value)
	if (sort === undefined || typeof sort.column !== "string") return undefined
	return { column: sort.column, direction: sort.direction === "ascending" ? "ascending" : "descending" }
}

export const primitive = definePrimitive("table", ({ document, tag, outer }) => {
	ensureTableSheet(document)
	guardRowChecks(document)
	const node = outer("div")
	const grid = part(document, "table", "grid")
	const head = part(document, "thead", "head")
	const headRow = part(document, "tr", "headRow")
	const selectHead = part(document, "th", "selectCell")
	const body = part(document, "tbody", "body")
	const skeleton = part(document, "tbody", "skeleton")
	skeleton.setAttribute("aria-hidden", "true")
	// Grid layout drops a table's implicit roles in some engines, so every level names its own.
	for (const group of [head, body]) group.setAttribute("role", "rowgroup")
	headRow.setAttribute("role", "row")
	selectHead.setAttribute("role", "columnheader")
	skeleton.hidden = true
	onShow(skeleton, "enter")
	const all = checkbox(document, "Select all rows", (selected) =>
		fire(primitive, "selectAll", { selected }),
	)
	selectHead.append(all.outer)
	headRow.append(selectHead)
	head.append(headRow)
	grid.append(head, body, skeleton)
	node.append(grid)

	let columns: ReturnType<typeof columnsOf> = []
	let sort: ReturnType<typeof sortOf>
	let selectable = false
	let loading = false
	let loadingRows = SKELETON_ROWS
	let allSelected = false
	let someSelected = false

	const drawHead = () => {
		for (const cell of [...headRow.children]) if (cell !== selectHead) cell.remove()
		for (const column of columns) {
			const cell = part(document, "th", "headCell")
			cell.setAttribute("scope", "col")
			cell.setAttribute("role", "columnheader")
			applyColumn(cell, column)
			const direction = sort?.column === column.key ? sort.direction : undefined
			if (direction !== undefined) cell.setAttribute("aria-sort", direction)
			if (column.sortable) {
				const button = part(document, "button", "sort")
				button.setAttribute("type", "button")
				if (direction !== undefined) button.dataset.sorted = direction
				const mark = part(document, "span", "sortMark")
				mark.setAttribute("aria-hidden", "true")
				mark.innerHTML = svg("chevron-down")
				button.append(column.label, mark)
				button.addEventListener("click", () => fire(primitive, "sort", { column: column.key }))
				const line = part(document, "span", "sortLine")
				line.append(button)
				cell.append(line)
			} else cell.append(column.label)
			headRow.append(cell)
		}
	}

	const drawSkeleton = () => {
		skeleton.replaceChildren()
		for (let index = 0; index < loadingRows; index++) {
			const row = part(document, "tr", "skeletonRow")
			const check = part(document, "td", "selectCell")
			const well = part(document, "span", "skeletonBar")
			loop(well, true)
			check.append(well)
			row.append(check)
			for (const column of columns) {
				const cell = part(document, "td", "skeletonCell")
				applyColumn(cell, column)
				const bar = part(document, "span", "skeletonBar")
				loop(bar, true)
				cell.append(bar)
				row.append(cell)
			}
			skeleton.append(row)
		}
	}

	const interactive = () => selectable || rowsOf(body).some((row) => row.hasAttribute("data-pressable"))

	/** Hands each row's cells their column, spans group headings, and keeps one row in the tab order. */
	const layout = () => {
		node.style.setProperty("--hz-table-columns", columnTracks(columns, selectable, false))
		node.style.setProperty("--hz-table-columns-compact", columnTracks(columns, selectable, true))
		const rows = rowsOf(body)
		const role = interactive() ? "grid" : "table"
		const cellRole = role === "grid" ? "gridcell" : "cell"
		const span = String(columns.length + (selectable ? 1 : 0))
		let selected = 0
		let choosable = 0
		for (const row of rows) {
			const group = row.hasAttribute("data-group")
			const footer = row.hasAttribute("data-footer")
			const heading = row.querySelector<HTMLElement>(':scope > [data-hz-part="heading"]')
			if (heading !== null && heading.getAttribute("colspan") !== span)
				heading.setAttribute("colspan", span)
			const cells = [...row.children].filter(
				(child): child is HTMLElement =>
					child instanceof HTMLElement && child.dataset.hz === "tableCell",
			)
			cells.forEach((cell, index) => {
				const key = cell.dataset.column
				applyColumn(cell, columns.find((column) => column.key === key) ?? columns[index])
				if (cell.getAttribute("role") !== cellRole) cell.setAttribute("role", cellRole)
			})
			const check = row.querySelector(':scope > [data-hz-part="selectCell"]')
			if (check !== null && check.getAttribute("role") !== cellRole)
				check.setAttribute("role", cellRole)
			if (selectable && !group && !footer) {
				choosable++
				const on = row.hasAttribute("data-selected")
				if (on) selected++
				if (row.getAttribute("aria-selected") !== String(on))
					row.setAttribute("aria-selected", String(on))
			} else if (row.hasAttribute("aria-selected")) row.removeAttribute("aria-selected")
		}
		const nextAll = choosable > 0 && selected === choosable
		const nextSome = selected > 0 && !nextAll
		if (nextAll !== allSelected) all.set("checked", (allSelected = nextAll))
		if (nextSome !== someSelected) all.set("indeterminate", (someSelected = nextSome))
		if (grid.getAttribute("role") !== role) grid.setAttribute("role", role)
		if (selectable) grid.setAttribute("aria-multiselectable", "true")
		else grid.removeAttribute("aria-multiselectable")
		tabOrder(role === "grid")
	}

	/** Roving focus: the current (j/k) row, else the focused one, else the first takes the tab stop. */
	const tabOrder = (on: boolean) => {
		const rows = rowsOf(body)
		if (!on) {
			for (const row of rows) row.removeAttribute("tabindex")
			return
		}
		const focusable = focusableRows(body)
		const active = document.activeElement
		const stop =
			focusable.find((row) => row.hasAttribute("data-current")) ??
			focusable.find((row) => row === active || (active !== null && row.contains(active))) ??
			focusable.find((row) => row.getAttribute("tabindex") === "0") ??
			focusable[0]
		for (const row of rows) {
			const index = !focusable.includes(row) ? undefined : row === stop ? "0" : "-1"
			if (index === undefined) row.removeAttribute("tabindex")
			else if (row.getAttribute("tabindex") !== index) row.setAttribute("tabindex", index)
		}
	}

	// A row that takes focus takes the tab stop; Ctrl or Cmd+A selects every row.
	body.addEventListener("focusin", (event) => {
		const row = event.target instanceof HTMLElement ? event.target : undefined
		if (row?.dataset.hz !== "tableRow" || row.getAttribute("tabindex") === null) return
		for (const other of focusableRows(body)) other.setAttribute("tabindex", other === row ? "0" : "-1")
	})
	grid.addEventListener("keydown", (event) => {
		if (!selectable || event.key.toLowerCase() !== "a" || !(event.metaKey || event.ctrlKey)) return
		if (!(event.target instanceof HTMLElement) || event.target.dataset.hz !== "tableRow") return
		if (fire(primitive, "selectAll", { selected: true })) event.preventDefault()
	})

	const win = document.defaultView
	if (win?.MutationObserver !== undefined)
		// Rows and cells coming and going or changing state; the table's own writes are not watched.
		new win.MutationObserver(layout).observe(body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"data-selected",
				"data-group",
				"data-footer",
				"data-current",
				"data-column",
				"data-disabled",
				"data-pressable",
			],
		})

	registerScroller(node, {
		rows: () => rowsOf(body),
		toEdge: (edge) => {
			const rows = rowsOf(body)
			const target = edge === "start" ? rows[0] : rows[rows.length - 1]
			target?.scrollIntoView({ block: edge === "start" ? "start" : "end" })
		},
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: body,
		set: (name, value) => {
			if (name === "label") {
				const text = textOf(value)
				if (text === "") grid.removeAttribute("aria-label")
				else grid.setAttribute("aria-label", text)
			} else if (name === "columns") {
				columns = columnsOf(value)
				drawHead()
				drawSkeleton()
				layout()
			} else if (name === "sort") {
				sort = sortOf(value)
				drawHead()
			} else if (name === "selectable") {
				selectable = value === true
				flag(node, "selectable", value)
				layout()
			} else if (name === "loading") {
				loading = value === true
				flag(node, "loading", value)
				skeleton.hidden = !loading
				if (loading) grid.setAttribute("aria-busy", "true")
				else grid.removeAttribute("aria-busy")
			} else if (name === "stickyHeader") flag(node, "sticky-header", value)
			else if (name === "frame") option(node, "frame", value)
			else if (name === "rowActions") option(node, "row-actions", value)
			else if (name === "loadingRows") {
				loadingRows = typeof value === "number" && value > 0 ? Math.round(value) : SKELETON_ROWS
				drawSkeleton()
			}
		},
		events: undefined,
	}
	layout()
	return primitive
})
