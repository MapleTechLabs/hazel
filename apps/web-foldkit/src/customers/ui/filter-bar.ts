import type { CustomersRange } from "@hazel/domain/customers"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { tabsStyles } from "~/components/ui/tabs.styles"
import { IconChevronDown, IconClose, IconPlus } from "../../icons"
import { button } from "../../ui/button"
import { searchField } from "../../ui/search-field"
import { formatCount } from "../format"
import { kbd } from "./shortcuts"

/**
 * The list and queue controls (Foundations › Filter Bar And Tabs): view tabs with counts, the
 * segmented control and range picker, search, filter chips, `+ Filter` and the sort trigger.
 * Stateless: selection comes in, the caller's Message goes out. Popovers and menus (the filter
 * builder, the sort menu) stay with the page; their triggers spread the menu's `attributes`.
 */

// VIEW TABS

export type ViewTab<K extends string> = Readonly<{ key: K; label: string; count?: number }>

/**
 * `Open 12 · Snoozed 4 · Done`, underlined like the app's tabs; `trailing` follows them (e.g. `+`).
 * Stateless, so no roving focus: every tab is a button in the Tab order.
 */
export const viewTabs = <M, K extends string>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		ariaLabel: string
		tabs: ReadonlyArray<ViewTab<K>>
		selected: K
		onSelect: (key: K) => M
		trailing?: Html
		className?: string
	}>,
): Html =>
	h.div(
		[h.Class(twMerge("flex items-center gap-1 border-border border-b", options.className))],
		[
			h.div(
				[
					h.Role("tablist"),
					h.AriaLabel(options.ariaLabel),
					h.Class("flex items-center gap-x-1 py-1"),
				],
				options.tabs.map((tab) => {
					const isSelected = tab.key === options.selected
					return h.button(
						[
							h.Type("button"),
							h.Role("tab"),
							h.AriaSelected(isSelected),
							...(isSelected ? [h.DataAttribute("selected", "true")] : []),
							h.Class(
								twMerge(...tabsStyles.tab("horizontal", false), "cursor-pointer gap-1.5"),
							),
							h.OnClick(options.onSelect(tab.key)),
						],
						[
							tab.label,
							...(tab.count === undefined
								? []
								: [
										h.span(
											[h.Class("text-muted-fg text-xs tabular-nums")],
											[formatCount(tab.count)],
										),
									]),
							...(isSelected
								? [
										h.span([
											h.AriaHidden(true),
											h.Class(twMerge(...tabsStyles.selectionIndicator("horizontal"))),
										]),
									]
								: []),
						],
					)
				}),
			),
			...(options.trailing ? [options.trailing] : []),
		],
	)

// SEGMENTED

export type Segment<K extends string> = Readonly<{ key: K; label: string }>

/** A radio group drawn as joined buttons: `7d 30d 90d 12m`, `Signals | Accounts`, `Customers | MRR`. */
export const segmented = <M, K extends string>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		ariaLabel: string
		segments: ReadonlyArray<Segment<K>>
		selected: K
		onSelect: (key: K) => M
		className?: string
	}>,
): Html =>
	h.div(
		[
			h.Role("radiogroup"),
			h.AriaLabel(options.ariaLabel),
			h.Class(
				twMerge(
					"inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5",
					options.className,
				),
			),
		],
		options.segments.map((segment) => {
			const isSelected = segment.key === options.selected
			return h.button(
				[
					h.Type("button"),
					h.Role("radio"),
					h.AriaChecked(isSelected),
					h.Class(
						twMerge(
							"h-7 cursor-pointer rounded-md px-2.5 font-medium text-sm tabular-nums outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/70",
							isSelected
								? "bg-primary text-primary-fg shadow-control"
								: "text-fg-3 hover:bg-secondary hover:text-fg",
						),
					),
					h.OnClick(options.onSelect(segment.key)),
				],
				[segment.label],
			)
		}),
	)

export const RANGE_SEGMENTS: ReadonlyArray<Segment<CustomersRange>> = [
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
	{ key: "12m", label: "12m" },
]

/** `vs previous period  7d 30d 90d 12m`. */
export const rangePicker = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		selected: CustomersRange
		onSelect: (range: CustomersRange) => M
		caption?: string | null
	}>,
): Html =>
	h.div(
		[h.Class("flex items-center gap-3")],
		[
			...(options.caption === null
				? []
				: [h.span([h.Class("text-muted-fg text-sm")], [options.caption ?? "vs previous period"])]),
			segmented(h, {
				ariaLabel: "Date range",
				segments: RANGE_SEGMENTS,
				selected: options.selected,
				onSelect: options.onSelect,
			}),
		],
	)

/** How a range reads in a comparison: `vs previous 30 days`. */
export const RANGE_COMPARISON = {
	"7d": "vs previous 7 days",
	"30d": "vs previous 30 days",
	"90d": "vs previous 90 days",
	"12m": "vs previous 12 months",
} as const satisfies Record<CustomersRange, string>

// SEARCH

/** The app's search field with a `/` hint while empty (the page binds `/` to focus `searchFieldIds(id).input`). */
export const searchBox = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		id: string
		value: string
		placeholder: string
		onInput: (value: string) => M
		onClear: M
		className?: string
	}>,
): Html =>
	h.div(
		[h.Class(twMerge("relative w-64", options.className))],
		[
			searchField(
				h,
				{
					id: options.id,
					value: options.value,
					onInput: options.onInput,
					onClear: options.onClear,
					ariaLabel: options.placeholder,
				},
				(parts) => [parts.searchInput({ placeholder: options.placeholder })],
			),
			...(options.value === ""
				? [
						h.span(
							[h.Class("pointer-events-none absolute top-1/2 right-2 -translate-y-1/2")],
							[kbd(h, "/")],
						),
					]
				: []),
		],
	)

// FILTER CHIPS

/** `Kind is Risk ×`; `values` joins with commas (`Severity is any of High, Medium`). */
export const filterChip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		field: string
		operator: string
		value: string
		onRemove: M
		/** Opens the chip's editor: spread a popover trigger's attributes here. */
		attributes?: ReadonlyArray<Attribute<M> | ChildAttribute>
		overlay?: Html
	}>,
): Html =>
	h.span(
		[
			h.Class(
				"inline-flex h-8 items-stretch overflow-hidden rounded-lg border border-border bg-secondary/50 text-sm",
			),
		],
		[
			h.button(
				[
					h.Type("button"),
					h.Class(
						"inline-flex cursor-pointer items-center gap-1 px-2.5 outline-hidden hover:bg-secondary focus-visible:bg-secondary",
					),
					...(options.attributes ?? []),
				],
				[
					h.span([h.Class("text-muted-fg")], [`${options.field} ${options.operator}`]),
					h.span([h.Class("font-medium text-fg")], [options.value]),
					...(options.overlay ? [options.overlay] : []),
				],
			),
			h.button(
				[
					h.Type("button"),
					h.AriaLabel(`Remove filter: ${options.field} ${options.operator} ${options.value}`),
					h.Class(
						"inline-flex w-7 cursor-pointer items-center justify-center border-border border-l text-muted-fg outline-hidden hover:bg-secondary hover:text-fg focus-visible:bg-secondary",
					),
					h.OnClick(options.onRemove),
				],
				[IconClose(h, { className: "size-3" })],
			),
		],
	)

/** `+ Filter`, dashed: the trigger of the page's filter builder popover. */
export const addFilterButton = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		attributes?: ReadonlyArray<Attribute<M> | ChildAttribute>
		overlay?: Html
		onPress?: M
	}> = {},
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "xs",
			className: "h-8 border-border border-dashed text-fg-3 hover:text-fg",
			onPress: options.onPress,
			attributes: options.attributes ?? [],
		},
		[IconPlus(h), "Filter", ...(options.overlay ? [options.overlay] : [])],
	)

/** `Sort Priority ⌄`: the trigger of the page's sort menu. */
export const sortTrigger = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		label: string
		attributes?: ReadonlyArray<Attribute<M> | ChildAttribute>
		overlay?: Html
	}>,
): Html =>
	button(h, { intent: "plain", size: "xs", className: "h-8 gap-1", attributes: options.attributes ?? [] }, [
		h.span([h.Class("text-muted-fg")], ["Sort"]),
		h.span([h.Class("font-medium text-fg")], [options.label]),
		IconChevronDown(h, { className: "size-3" }),
		...(options.overlay ? [options.overlay] : []),
	])

/** The row the controls sit in: filters left, the rest right. */
export const filterBar = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ start: ReadonlyArray<Html>; end?: ReadonlyArray<Html>; className?: string }>,
): Html =>
	h.div(
		[h.Class(twMerge("flex flex-wrap items-center justify-between gap-2", options.className))],
		[
			h.div([h.Class("flex min-w-0 flex-wrap items-center gap-2")], [...options.start]),
			...(options.end ? [h.div([h.Class("flex items-center gap-3")], [...options.end])] : []),
		],
	)
