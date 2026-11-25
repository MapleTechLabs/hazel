import type { CustomersRange } from "@hazel/domain/customers"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown, IconClose, IconPlus } from "../../icons"
import { ariaButton, button } from "../../ui/button"
import { searchField } from "../../ui/search-field"
import { tabClassName, tabIndicatorClassName } from "../../ui/tab-strip"
import { formatCount } from "../format"
import { type Segment, segmented } from "../../ui/segmented-control"
import { kbd } from "./shortcuts"

/**
 * The list and queue controls (Foundations › Filter Bar And Tabs): view tabs with counts, the
 * segmented control and range picker, search, filter chips, `+ Filter` and the sort trigger.
 * Stateless: selection comes in, the caller's Message goes out. Popovers and menus (the filter
 * builder, the sort menu) stay with the page; their triggers spread the menu's `attributes`.
 */

// VIEW TABS

export type ViewTab<K extends string> = Readonly<{
	key: K
	label: string
	count?: number
	/** Before the label, e.g. a saved view's icon. */
	leading?: Html
}>

/**
 * `Open 12 · Snoozed 4 · Done`, underlined like the app's tabs; `trailing` follows them
 * (give it `shrink-0`). Stateless, so no roving focus: every tab is a button in the Tab order.
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
		/** On the tab list (e.g. a drop target). */
		listAttributes?: ReadonlyArray<Attribute<M>>
		/** Per tab, e.g. dragging to reorder (`sortable.ts`). */
		tabProps?: (
			tab: ViewTab<K>,
			index: number,
		) => Readonly<{ attributes: ReadonlyArray<Attribute<M>>; className: string }>
	}>,
): Html =>
	h.div(
		[
			h.Class(
				twMerge("flex items-center gap-1 border-border border-b max-md:min-w-0", options.className),
			),
		],
		[
			h.div(
				[
					...(options.listAttributes ?? []),
					h.Role("tablist"),
					h.AriaLabel(options.ariaLabel),
					// A phone scrolls the tabs sideways, not the page or `trailing`. The extra pixel of padding
					// keeps the selected tab's underline (1px past the tabs) inside the scroller and `-mb-px`
					// lays it back on the border; the end fades over padding that is empty once scrolled.
					h.Class(
						"flex items-center gap-x-1 py-1 max-md:-mb-px max-md:min-w-0 max-md:overflow-x-auto max-md:pr-6 max-md:pb-1.25 max-md:mask-r-from-[calc(100%-1.5rem)] max-md:[scrollbar-width:none]",
					),
				],
				options.tabs.map((tab, index) => {
					const isSelected = tab.key === options.selected
					const extra = options.tabProps?.(tab, index)
					return ariaButton(
						h,
						{
							className: tabClassName(twMerge("cursor-pointer gap-1.5", extra?.className)),
							onPress: options.onSelect(tab.key),
							attributes: [
								...(extra?.attributes ?? []),
								h.Key(tab.key),
								h.Role("tab"),
								h.AriaSelected(isSelected),
								...(isSelected ? [h.DataAttribute("selected", "true")] : []),
							],
						},
						[
							...(tab.leading === undefined ? [] : [tab.leading]),
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
								? [h.span([h.AriaHidden(true), h.Class(tabIndicatorClassName())])]
								: []),
						],
					)
				}),
			),
			...(options.trailing ? [options.trailing] : []),
		],
	)

// SEGMENTED

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
		[h.Class("flex flex-wrap items-center gap-x-3 gap-y-2")],
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
		[h.Class(twMerge("relative w-64 max-md:w-full", options.className))],
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
				"inline-flex h-8 max-w-full items-stretch rounded-lg border border-border bg-secondary/50 text-sm max-md:h-10",
			),
		],
		[
			ariaButton(
				h,
				{
					className:
						"inline-flex min-w-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-l-lg px-2.5 outline-hidden hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70",
					attributes: options.attributes ?? [],
				},
				[
					h.span([h.Class("shrink-0 text-muted-fg")], [`${options.field} ${options.operator}`]),
					// A long value (`High, Medium, Low, …`) truncates on one line; the chip's height is fixed.
					h.span(
						[h.Class("truncate font-medium text-fg"), h.Title(options.value)],
						[options.value],
					),
					...(options.overlay ? [options.overlay] : []),
				],
			),
			ariaButton(
				h,
				{
					className:
						"inline-flex w-7 shrink-0 cursor-pointer items-center justify-center rounded-r-lg border-border border-l text-muted-fg outline-hidden hover:bg-secondary hover:text-fg focus-visible:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/70 max-md:w-10",
					onPress: options.onRemove,
					attributes: [
						h.AriaLabel(`Remove filter: ${options.field} ${options.operator} ${options.value}`),
					],
				},
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
			className: "h-8 border-border border-dashed text-fg-3 hover:text-fg max-md:h-10",
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
	button(
		h,
		{
			intent: "plain",
			size: "xs",
			className: "h-8 gap-1 max-md:h-10",
			attributes: options.attributes ?? [],
		},
		[
			h.span([h.Class("text-muted-fg")], ["Sort"]),
			h.span([h.Class("font-medium text-fg")], [options.label]),
			IconChevronDown(h, { className: "size-3" }),
			...(options.overlay ? [options.overlay] : []),
		],
	)

/** The row the controls sit in: filters left, the rest right. */
export const filterBar = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ start: ReadonlyArray<Html>; end?: ReadonlyArray<Html>; className?: string }>,
): Html =>
	h.div(
		[h.Class(twMerge("flex flex-wrap items-center justify-between gap-2", options.className))],
		[
			h.div([h.Class("flex min-w-0 flex-wrap items-center gap-2 max-md:w-full")], [...options.start]),
			...(options.end ? [h.div([h.Class("flex items-center gap-3")], [...options.end])] : []),
		],
	)
