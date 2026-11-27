// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The list and queue controls (today's `web-foldkit/src/customers/ui/filter-bar.ts` and
 * `shortcuts.ts`): view tabs with counts, the range picker, search, filter chips, `+ Filter`, the
 * sort trigger and the keyboard hint bar. Selection comes in, the caller's message goes out.
 */
import type { CustomersRange } from "@hazel/domain/customers"
import type { Content, Hazel, TextField } from "@hazel/ui/vocabulary/index"

// VIEW TABS

export type ViewTab<K extends string> = Readonly<{ key: K; label: string; count?: number }>

/** `Open 12 · Snoozed 4 · Done` as in-page tabs; `trailing` follows them. */
export const viewTabs = <Msg, K extends string>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		tabs: ReadonlyArray<ViewTab<K>>
		selected: K
		onSelect: (key: K) => Msg
		/** Saved views the user drags to reorder: `move` reports the tab and the one it lands before. */
		onMove?: (move: Readonly<{ id: K; before: K | null }>) => Msg
		trailing?: Hazel.NoTextInput<Msg>
	}>,
) => {
	const byKey = new Map(options.tabs.map((tab) => [tab.key as string, tab.key]))
	// HAZEL-GAP(p4-customers-tab-leading): today a saved view's tab leads with its icon or tinted dot (`view-look.ts`); `Tab.icon` is an `IconName` with no tint.
	const tabs: ReadonlyArray<Content.Tab> = options.tabs.map((tab) => ({
		id: tab.key,
		label: tab.label,
		badge: tab.count,
	}))
	const bar = h.tabBar
		.style("page")
		.tabs(tabs)
		.selected(options.selected)
		.reorderable(options.onMove !== undefined)
		.on("change", ({ id }) => options.onSelect(byKey.get(id) ?? options.selected))
	const onMove = options.onMove
	const withMove =
		onMove === undefined
			? bar
			: bar.on("move", ({ id, before }) =>
					onMove({
						id: byKey.get(id) ?? options.selected,
						before: before === null ? null : (byKey.get(before) ?? null),
					}),
				)
	return options.trailing === undefined
		? withMove
		: h.stack.axis("horizontal").align("center").children(withMove, options.trailing)
}

// RANGE

export const RANGES: ReadonlyArray<CustomersRange> = ["7d", "30d", "90d", "12m"]

const isRange = (value: string | undefined): value is CustomersRange =>
	RANGES.some((range) => range === value)

/** `vs previous period  7d 30d 90d 12m`; `caption: null` drops the words. */
export const rangePicker = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		selected: CustomersRange
		onSelect: (range: CustomersRange) => Msg
		caption?: string | null
	}>,
) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.children(
			options.caption === null
				? null
				: h.text.tone("muted").children(options.caption ?? "vs previous period"),
			h.choiceGroup
				.style("segmented")
				.label("Date range")
				.options(RANGES.map((range) => ({ value: range, label: range })))
				.selected([options.selected])
				.on("change", ({ selected }) => {
					const [range] = selected
					return options.onSelect(isRange(range) ? range : options.selected)
				}),
		)

// SEARCH

/** The search field; the page binds `/` to focus it and keeps its `TextField.State`. */
export const searchBox = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		value: TextField.State
		placeholder: string
		onChange: (payload: TextField.ChangePayload) => Msg
	}>,
) =>
	// HAZEL-GAP(p4-customers-search-hint): today the empty field shows a `/` key cap at its end and is `w-64` (full width on phones); `searchField` has neither.
	h.searchField.placeholder(options.placeholder).value(options.value).on("change", options.onChange)

// FILTERS

/** `Kind is Risk ×`: a press edits it (the page anchors its popover here), the mark removes it. */
export const filterChip = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{ field: string; operator: string; value: string; onPress?: Msg; onRemove: Msg }>,
) => {
	// HAZEL-GAP(p4-customers-filter-chip): today's chip is a square 32px box, `field operator` muted then the value strong and truncated, with a divided remove half; `chip` is round, one run.
	const chip = h.button
		.variant("chip")
		.size("small")
		.label(`${options.field} ${options.operator} ${options.value}`)
		.removable()
		.on("remove", options.onRemove)
	return options.onPress === undefined ? chip : chip.on("press", options.onPress)
}

/** `+ Filter`: the trigger of the page's filter builder popover. */
export const addFilterButton = <Msg>(h: Hazel.H<Msg>, options: Readonly<{ onPress?: Msg }> = {}) => {
	// HAZEL-GAP(p4-customers-dashed-button): today's `+ Filter` has a dashed edge in `fg-3` ink; no button variant is dashed.
	const button = h.button.label("Filter").icon("plus").variant("ghost").size("xsmall")
	return options.onPress === undefined ? button : button.on("press", options.onPress)
}

/** `Sort Priority`: the trigger of the page's sort menu (`menu`'s `trigger` slot). */
export const sortTrigger = <Msg>(h: Hazel.H<Msg>, options: Readonly<{ label: string }>) =>
	// HAZEL-GAP(p4-customers-sort-trigger): today "Sort" is muted, the label strong, and a chevron trails; a button label is one run with a leading icon.
	h.button.label(`Sort ${options.label}`).icon("chevron-down").variant("ghost").size("xsmall")

/** The row the controls sit in: filters at the start, the rest at the end. */
export const filterBar = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		start: ReadonlyArray<Hazel.NoTextInput<Msg>>
		end?: ReadonlyArray<Hazel.NoTextInput<Msg>>
	}>,
) =>
	// HAZEL-GAP(p4-customers-wrap-row): today the bar and its chips wrap onto more lines (`flex-wrap`); a horizontal stack never wraps.
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(...options.start),
			options.end === undefined ? null : h.spacer,
			options.end === undefined
				? null
				: h.stack
						.axis("horizontal")
						.align("center")
						.children(...options.end),
		)

// KEYBOARD HINTS

export type Shortcut = Readonly<{ keys: ReadonlyArray<string>; label: string }>

/** One key cap. */
export const kbd = <Msg>(h: Hazel.H<Msg>, key: string) => h.text.role("kbd").children(key)

/** `j k Navigate · a Assign · …`: the queue's hint bar. */
export const shortcutBar = <Msg>(h: Hazel.H<Msg>, shortcuts: ReadonlyArray<Shortcut>) =>
	// HAZEL-GAP(p4-customers-web-only): today's bar hides on phones (`max-md:hidden`); a view has no size class to hide by.
	h.stack
		.axis("horizontal")
		.align("center")
		.children(
			...shortcuts.map((shortcut) =>
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.children(
						h.stack
							.axis("horizontal")
							.density("tight")
							.children(...shortcut.keys.map((key) => kbd(h, key))),
						h.text.role("caption").tone("muted").children(shortcut.label),
					),
			),
		)
