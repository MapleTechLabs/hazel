import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown } from "../../icons"
import { checkbox } from "../../ui/checkbox"

/**
 * A dense, sortable data table (Foundations › Table Customers States): sticky header, sort
 * indicators, optional selection checkboxes, hover/selected rows, row actions on hover, skeleton
 * rows while loading and a footer summary row. A real `<table>`; the page owns sort, selection and
 * which rows to show.
 */

export type SortDirection = "asc" | "desc"

export type Column<Row, K extends string = string> = Readonly<{
	key: K
	label: string
	align?: "left" | "right"
	sortable?: boolean
	/** Header and cell width, e.g. `w-40`; one column without a width takes the rest. */
	widthClass?: string
	/** Hide below a breakpoint, e.g. `max-lg:hidden`. */
	hideClass?: string
	cell: (row: Row) => Html | string
	/** The footer summary row's cell. */
	footer?: Html | string
}>

export type DataTableOptions<Row, M, K extends string = string> = Readonly<{
	/** Names the table for assistive tech. */
	ariaLabel: string
	/** Prefix for the checkboxes' ids. */
	id: string
	columns: ReadonlyArray<Column<Row, K>>
	rows: ReadonlyArray<Row>
	rowKey: (row: Row) => string
	sort?: Readonly<{ key: K; direction: SortDirection }> | null
	/** A press on a sortable header (the page flips the direction or switches the column). */
	onSort?: (key: K) => M
	selection?: Readonly<{
		selected: ReadonlySet<string>
		onToggle: (rowKey: string, isSelected: boolean) => M
		onToggleAll: (isSelected: boolean) => M
	}>
	/** A press on a row (outside its checkbox and actions). */
	onRowPress?: (row: Row) => M
	/** The keyboard-focused row (j/k), drawn like a hover. */
	focusedKey?: string | null
	/** Shown over the last cell while a row is hovered or focused (`⋯` menu, quick actions). */
	rowActions?: (row: Row) => Html
	/** Skeleton rows instead of `rows`. */
	loadingRows?: number
	/** Stick the header to the top of the scrolling container. */
	stickyHeader?: boolean
	className?: string
}>

const alignClass = (align: "left" | "right" | undefined) => (align === "right" ? "text-right" : "text-left")

export const dataTable = <Row, M, K extends string = string>(
	h: HtmlBuilder<M>,
	options: DataTableOptions<Row, M, K>,
): Html => {
	const { selection } = options
	const isLoading = options.loadingRows !== undefined
	const selectedCount = selection
		? options.rows.filter((row) => selection.selected.has(options.rowKey(row))).length
		: 0
	const allSelected = options.rows.length > 0 && selectedCount === options.rows.length
	const hasFooter = options.columns.some((column) => column.footer !== undefined)
	const cellPad = "px-3 first:pl-4 last:pr-4"

	const header = (column: Column<Row, K>): Html => {
		const direction = options.sort && options.sort.key === column.key ? options.sort.direction : null
		const isSorted = direction !== null
		const label =
			column.sortable && options.onSort
				? h.button(
						[
							h.Type("button"),
							h.Class(
								twMerge(
									"inline-flex cursor-pointer items-center gap-1 rounded outline-hidden hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
									isSorted && "font-medium text-fg",
								),
							),
							h.OnClick(options.onSort(column.key)),
						],
						[
							column.label,
							h.span(
								[
									h.AriaHidden(true),
									h.Class(
										twMerge(
											"inline-flex size-4 items-center justify-center rounded",
											isSorted ? "bg-secondary text-fg" : "invisible",
										),
									),
								],
								[
									IconChevronDown(h, {
										className: twMerge("size-3", direction === "asc" && "rotate-180"),
									}),
								],
							),
						],
					)
				: column.label
		return h.th(
			[
				h.Scope("col"),
				...(isSorted ? [h.AriaSort(direction === "asc" ? "ascending" : "descending")] : []),
				h.Class(
					twMerge(
						"h-10 whitespace-nowrap font-normal text-muted-fg text-sm",
						cellPad,
						alignClass(column.align),
						column.widthClass,
						column.hideClass,
					),
				),
			],
			[label],
		)
	}

	const selectionHeader = selection
		? [
				h.th(
					[h.Class("w-10 pl-4")],
					[
						checkbox(
							h,
							{
								id: `${options.id}-all`,
								isSelected: allSelected,
								isIndeterminate: selectedCount > 0 && !allSelected,
								ariaLabel: "Select all rows",
								onChange: selection.onToggleAll,
							},
							[],
						),
					],
				),
			]
		: []

	const row = (entry: Row): Html => {
		const key = options.rowKey(entry)
		const isSelected = selection?.selected.has(key) ?? false
		const isFocused = options.focusedKey === key
		const lastIndex = options.columns.length - 1
		return h.tr(
			[
				h.Key(key),
				...(selection ? [h.AriaSelected(isSelected)] : []),
				...(isFocused ? [h.DataAttribute("focused", "true")] : []),
				h.Class(
					twMerge(
						"group/row transition-colors",
						options.onRowPress && "cursor-pointer",
						isSelected ? "bg-primary-subtle/40" : "hover:bg-wash data-focused:bg-wash",
					),
				),
				...(options.onRowPress ? [h.OnClick(options.onRowPress(entry))] : []),
			],
			[
				...(selection
					? [
							h.td(
								[h.Class("w-10 pl-4")],
								[
									checkbox(
										h,
										{
											id: `${options.id}-${key}`,
											isSelected,
											ariaLabel: "Select row",
											stopsClickPropagation: true,
											onChange: (next) => selection.onToggle(key, next),
										},
										[],
									),
								],
							),
						]
					: []),
				...options.columns.map((column, columnIndex) =>
					h.td(
						[
							h.Class(
								twMerge(
									"h-14 text-fg text-sm tabular-nums",
									cellPad,
									alignClass(column.align),
									column.widthClass,
									column.hideClass,
									columnIndex === lastIndex && options.rowActions && "relative",
								),
							),
						],
						columnIndex === lastIndex && options.rowActions
							? [
									h.div(
										[
											h.Class(
												"group-hover/row:invisible group-data-focused/row:invisible",
											),
										],
										[column.cell(entry)],
									),
									h.div(
										[
											h.Class(
												"invisible absolute inset-y-0 right-2 flex items-center gap-1 group-focus-within/row:visible group-hover/row:visible group-data-focused/row:visible",
											),
										],
										[options.rowActions(entry)],
									),
								]
							: [column.cell(entry)],
					),
				),
			],
		)
	}

	const skeleton = (index: number): Html =>
		h.tr(
			[h.Key(`skeleton-${index}`), h.AriaHidden(true)],
			[
				...(selection
					? [h.td([h.Class("w-10 pl-4")], [h.span([h.Class("block size-4 rounded bg-secondary")])])]
					: []),
				...options.columns.map((column) =>
					h.td(
						[h.Class(twMerge("h-14", cellPad, column.widthClass, column.hideClass))],
						[
							h.span([
								h.Class(
									twMerge(
										"block h-3.5 animate-pulse rounded bg-secondary",
										column.align === "right" ? "ml-auto w-12" : "w-3/4",
									),
								),
							]),
						],
					),
				),
			],
		)

	return h.div(
		[h.Class(twMerge("overflow-x-auto rounded-xl border border-border", options.className))],
		[
			h.table(
				[
					h.AriaLabel(options.ariaLabel),
					...(isLoading ? [h.AriaBusy(true)] : []),
					h.Class("w-full border-separate border-spacing-0"),
				],
				[
					h.thead(
						[],
						[
							h.tr(
								[
									h.Class(
										twMerge(
											"[&>th]:border-border [&>th]:border-b",
											options.stickyHeader &&
												"[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-bg",
										),
									),
								],
								[...selectionHeader, ...options.columns.map(header)],
							),
						],
					),
					h.tbody(
						[h.Class("[&>tr+tr>td]:border-border [&>tr+tr>td]:border-t")],
						isLoading
							? Array.from({ length: options.loadingRows ?? 0 }, (_, index) => skeleton(index))
							: options.rows.map(row),
					),
					...(hasFooter && !isLoading
						? [
								h.tfoot(
									[],
									[
										h.tr(
											[h.Class("[&>td]:border-border [&>td]:border-t [&>td]:bg-wash")],
											[
												...(selection ? [h.td([h.Class("w-10 pl-4")])] : []),
												...options.columns.map((column) =>
													h.td(
														[
															h.Class(
																twMerge(
																	"h-11 font-medium text-fg text-sm tabular-nums",
																	cellPad,
																	alignClass(column.align),
																	column.widthClass,
																	column.hideClass,
																),
															),
														],
														[column.footer ?? ""],
													),
												),
											],
										),
									],
								),
							]
						: []),
				],
			),
		],
	)
}

/** `Name` over `domain` with a logo: the customer cell. */
export const primaryCell = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ leading?: Html; title: string; subtitle?: string | null; href?: string }>,
): Html =>
	h.div(
		[h.Class("flex min-w-0 items-center gap-3")],
		[
			...(options.leading ? [options.leading] : []),
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					options.href
						? h.a(
								[
									h.Href(options.href),
									h.Class("truncate font-medium text-fg hover:underline"),
								],
								[options.title],
							)
						: h.span([h.Class("truncate font-medium text-fg")], [options.title]),
					...(options.subtitle
						? [h.span([h.Class("truncate text-muted-fg text-xs")], [options.subtitle])]
						: []),
				],
			),
		],
	)
