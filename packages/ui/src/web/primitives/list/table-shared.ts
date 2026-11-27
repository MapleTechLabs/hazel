// Owned by lane A4 (phase 4, W8). What `table`, `tableRow` and `tableCell` share: the layout sheet,
// the select column's checkbox (the toggle's own renderer), and the click guard for it. Not a
// primitive (no `primitive` export, so the glob registry skips it).
import { primitive as toggleRenderer } from "../controls/toggle.ts"
import type { Plain } from "../define.ts"
import { ensureSheet } from "./runtime.ts"

const T = '[data-hz="table"]'
const GRID = `${T} > [data-hz-part="grid"]`
const HEAD_ROW = `${GRID} > [data-hz-part="head"] > [data-hz-part="headRow"]`
const BODY = `${GRID} > [data-hz-part="body"]`
const SKELETON_ROW = `${GRID} > [data-hz-part="skeleton"] > [data-hz-part="skeletonRow"]`
const R = '[data-hz="tableRow"]'
const ROW = `${BODY} > ${R}`
const CELL = '[data-hz="tableCell"]'
const ACTIONS = '[data-hz-slot="actions"]'
/** A cell of the data columns, wherever it sits: head, body or skeleton. */
const COLUMN_CELL = `:is(${CELL}, [data-hz-part="headCell"], [data-hz-part="skeletonCell"])`
const first = (of: string) => `:nth-child(1 of ${of})`
const last = (of: string) => `:nth-last-child(1 of ${of})`
const hidden =
	"position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;"

// Today's `ui/data-table.ts` layout over a CSS grid, not table layout: an absolutely placed child of a
// table row (the actions slot) gets an anonymous cell in some engines. The table sets its column
// tracks (`--hz-table-columns`, `columnTracks`); its row groups and rows are subgrids of them.
const css = `
${T} { display: block; overflow-x: auto; }
${T}[data-sticky-header] { overflow: visible; }
${GRID} { display: grid; grid-template-columns: var(--hz-table-columns); }
@media (width < 40rem) { ${GRID} { grid-template-columns: var(--hz-table-columns-compact); } }
${GRID} > *, ${GRID} > * > * { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
${T} :is([data-hz-part="headCell"], [data-hz-part="selectCell"], [data-hz-part="heading"], [data-hz-part="skeletonCell"], ${CELL}) {
	display: grid; grid-template-columns: 1fr; align-content: center; text-align: start;
}
${HEAD_ROW} > * { min-height: var(--hz-space-9); }
${T}[data-sticky-header] ${GRID} > [data-hz-part="head"] { position: sticky; top: 0; z-index: 10; background-color: var(--hz-color-bg); }
${ROW} > *, ${SKELETON_ROW} > * { min-height: calc(var(--hz-space-1) * 13); }
${ROW}[data-footer] > * { min-height: var(--hz-space-11); }
${ROW}[data-footer] > ${CELL} { font-weight: var(--hz-weight-strong); }
${T}:not([data-selectable]) :is([data-hz-part="selectCell"]) { display: none; }
${ROW}:is([data-group], [data-footer]) > [data-hz-part="selectCell"] > * { display: none; }
${ROW}[data-group] > [data-hz-part="selectCell"] { display: none; }
${ROW}[data-group] > [data-hz-part="heading"] { grid-column: 1 / -1; min-height: 0; }
${ROW}:not([data-group]) > [data-hz-part="heading"] { display: none; }
${T} [data-hz-part="selectCell"] > [data-hz="toggle"] > [data-hz-part="text"] { ${hidden} }
/* Today's label-less checkbox: the box \`--indicator-mt\` (3px, 4px regular) under a top-aligned label. */
${T} [data-hz-part="selectCell"] > [data-hz="toggle"] > [data-hz-part="control"] {
	min-height: 0; padding-top: calc(var(--hz-space-1) * 0.75);
}
@media (width >= 40rem) {
	${T} [data-hz-part="selectCell"] > [data-hz="toggle"] > [data-hz-part="control"] { padding-top: var(--hz-space-1); }
}

/* Hairlines: under the head, and between body rows (\`tr+tr>td\`), the footer's too. */
${ROW} + ${R} > :is(${CELL}, [data-hz-part="selectCell"], [data-hz-part="heading"]),
${SKELETON_ROW} + [data-hz-part="skeletonRow"] > * { border-top: 1px solid var(--hz-color-border); }

/* \`first:pl-4 last:pr-4\` over the data columns; the select column is the first when it shows. */
${T}:not([data-selectable]) :is(${HEAD_ROW}, ${ROW}, ${SKELETON_ROW}) > ${COLUMN_CELL}${first(COLUMN_CELL)} {
	padding-inline-start: var(--hz-space-4);
}
${T} :is(${HEAD_ROW}, ${ROW}, ${SKELETON_ROW}) > ${COLUMN_CELL}${last(COLUMN_CELL)} { padding-inline-end: var(--hz-space-4); }

${T} ${COLUMN_CELL}[data-align="end"] { text-align: end; }
${T} ${COLUMN_CELL}[data-width="fill"] { grid-template-columns: minmax(0, 1fr); }
${T} ${COLUMN_CELL}[data-width="fill"] > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (width < 40rem) { ${T} ${COLUMN_CELL}[data-optional] { display: none; } }

/* The sort control: the chevron on the inner side, so the label lines up with the cells. */
/* In a line box of its own, as in today's cell: a reversed control's baseline is its chevron well's. */
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] { display: block; }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"] { cursor: pointer; }
${HEAD_ROW} > [data-hz-part="headCell"][data-align="end"] > [data-hz-part="sortLine"] > [data-hz-part="sort"] { flex-direction: row-reverse; }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"]:is(:hover, [data-sorted]) { color: var(--hz-color-fg); }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: 0; }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"]:not([data-sorted]) > [data-hz-part="sortMark"] { visibility: hidden; }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"] > [data-hz-part="sortMark"] > svg { width: var(--hz-space-3); height: var(--hz-space-3); }
${HEAD_ROW} > [data-hz-part="headCell"] > [data-hz-part="sortLine"] > [data-hz-part="sort"][data-sorted="ascending"] > [data-hz-part="sortMark"] > svg { rotate: 180deg; }

/* Skeleton bars: \`h-3.5 w-3/4\`, an end column's \`ml-auto w-12\`, the checkbox's \`size-4\` well. */
${SKELETON_ROW} > [data-hz-part="skeletonCell"] > [data-hz-part="skeletonBar"] { display: block; height: var(--hz-space-3_5); width: 75%; }
${SKELETON_ROW} > [data-hz-part="skeletonCell"][data-align="end"] > [data-hz-part="skeletonBar"] { width: var(--hz-space-12); margin-inline-start: auto; }
${SKELETON_ROW} > [data-hz-part="selectCell"] { padding-inline-start: var(--hz-space-4); }
${SKELETON_ROW} > [data-hz-part="selectCell"] > [data-hz-part="skeletonBar"] {
	display: block; width: var(--hz-space-4); height: var(--hz-space-4);
	border-radius: var(--hz-radius-sm); background-color: var(--hz-color-secondary);
}
${T}[data-loading] > [data-hz-part="grid"] > [data-hz-part="body"] { display: none; }

/* Rows: pressable ones point; a disabled row takes no pointer; a group heading never washes. */
${ROW} { position: relative; }
${ROW}[data-pressable] { cursor: pointer; }
${ROW}[data-disabled] { pointer-events: none; }
${ROW}[data-group]:hover { background-color: transparent; }
${ROW}:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: -2px; }

/* Row actions over the last cell while the row is hovered, focused or current (today's \`rowActions\`). */
${ROW} > ${ACTIONS} { position: absolute; inset-block: 0; inset-inline-end: var(--hz-space-2); visibility: hidden; }
${ROW}:is(:hover, :focus-within, [data-current]) > ${ACTIONS} { visibility: visible; }
${ROW}:is(:hover, [data-current]):has(> ${ACTIONS} > *) > ${CELL}${last(CELL)} > * { visibility: hidden; }
`

export const ensureTableSheet = (document: Document) => ensureSheet(document, "table", css)

/** A column's layout, as the table hands it to its cells (`data-align`, `data-width`, `data-optional`). */
export interface ColumnLayout {
	readonly key: string
	readonly align: "start" | "end"
	readonly width: string
	readonly optional: boolean
}

const fixed = {
	narrow: "var(--hz-space-24)",
	regular: "calc(var(--hz-space-8) * 4)",
	wide: "calc(var(--hz-space-11) * 4)",
} as const

const fixedTrack = (width: string) =>
	width === "narrow" || width === "regular" || width === "wide" ? fixed[width] : undefined

/**
 * The grid's column tracks, as today's table lays them out. With a `fill` column (the rest, down to
 * w-40) every other column takes its content's width, as Chromium's table layout gives today's `w-*`
 * columns beside a `w-full` one. Without one, `narrow` is w-24, `regular` w-32, `wide` w-44, the select
 * column w-10, and `auto` columns share the rest. On compact the `optional` columns go.
 */
export const columnTracks = (columns: ReadonlyArray<ColumnLayout>, selectable: boolean, compact: boolean) => {
	const shown = compact ? columns.filter((column) => !column.optional) : columns
	const fills = shown.some((column) => column.width === "fill")
	const tracks = shown.map((column) =>
		column.width === "fill"
			? "minmax(calc(var(--hz-space-10) * 4), 1fr)"
			: fills
				? "min-content"
				: (fixedTrack(column.width) ?? "minmax(max-content, 1fr)"),
	)
	const select = fills ? "min-content" : "var(--hz-space-10)"
	return [...(selectable ? [select] : []), ...tracks].join(" ") || "minmax(0, 1fr)"
}

export const applyColumn = (cell: HTMLElement, column: ColumnLayout | undefined) => {
	if (column === undefined) {
		cell.removeAttribute("data-align")
		cell.removeAttribute("data-width")
		cell.removeAttribute("data-optional")
		return
	}
	if (column.align === "end") cell.setAttribute("data-align", "end")
	else cell.removeAttribute("data-align")
	if (column.width === "auto") cell.removeAttribute("data-width")
	else cell.setAttribute("data-width", column.width)
	if (column.optional) cell.setAttribute("data-optional", "")
	else cell.removeAttribute("data-optional")
}

/**
 * The select column's checkbox: the toggle's renderer in `checkbox` style, its label read only by
 * assistive tech. `change` reports the next value (mixed goes to checked).
 */
export const checkbox = (document: Document, label: string, onChange: (selected: boolean) => void) => {
	const made = toggleRenderer.create({
		document,
		tag: "hz:toggle",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "toggle"
			return node
		},
		self: (node, set) => ({ tag: "hz:toggle", outer: node, content: node, set, events: undefined }),
	})
	made.set("style", "checkbox")
	made.set("label", label)
	made.events = {
		handlers: { change: true },
		dispatch: (_event, _handler, payload: Plain) => {
			const checked = typeof payload === "object" && payload !== null && "checked" in payload
			onChange(checked && (payload as { readonly checked: unknown }).checked === true)
			return true
		},
	}
	return made
}

/** Each row's own select handler, for the guard below. */
const rowSelect = new WeakMap<Element, () => void>()

export const onRowSelect = (row: Element, select: () => void) => rowSelect.set(row, select)

const guarded = new WeakSet<Document>()

/**
 * A row's checkbox sits inside the row, and the host delivers `press` from a capture listener at the
 * document root, so its click would press the row too (today's `stopsClickPropagation`). One capture
 * listener on the window, which runs first, takes that click for the row's `select` and stops it.
 */
export const guardRowChecks = (document: Document) => {
	const view = document.defaultView
	if (view === null || guarded.has(document)) return
	guarded.add(document)
	view.addEventListener(
		"click",
		(event) => {
			const target = event.target
			if (!(target instanceof Element)) return
			const check = target.closest(`${R} > [data-hz-part="selectCell"] > [data-hz="toggle"]`)
			const row = check?.parentElement?.parentElement
			const select = row === null || row === undefined ? undefined : rowSelect.get(row)
			if (select === undefined) return
			event.stopImmediatePropagation()
			event.preventDefault()
			select()
		},
		true,
	)
}

/** The rows a table's keyboard moves through: not group, footer or disabled rows. */
export const focusableRows = (body: Element): ReadonlyArray<HTMLElement> =>
	[...body.children].filter(
		(row): row is HTMLElement =>
			row instanceof HTMLElement &&
			row.dataset.hz === "tableRow" &&
			!row.hasAttribute("data-group") &&
			!row.hasAttribute("data-footer") &&
			!row.hasAttribute("data-disabled"),
	)
