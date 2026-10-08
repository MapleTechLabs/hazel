import { formatDistanceToNow } from "../../page/notifications/inbox/format"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getFilterTypeLabel } from "~/lib/search-filter-parser"
import { cn } from "~/lib/utils"
import { IconClose, IconHashtag, IconMagnifier3 } from "../../icons"
import { avatar } from "../../ui/avatar"
import { Message } from "./message"
import type { Model, PageState } from "./model"
import { searchResultItem } from "./search-result"
import { MountSearchEditor } from "./search-mount"
import { searchPlaceholder } from "./search-update"

/** `SearchView` and `SearchSlateEditor` (`components/command-palette/search-*.tsx`). */

type SearchPage = Extract<PageState, { _tag: "Search" }>

const KBD = "inline-grid h-4 min-w-4 place-content-center rounded-xs bg-secondary px-1"

const emptyState = (h: HtmlBuilder<Message>, message: string): Html =>
	h.div(
		[h.Class("flex flex-col items-center justify-center py-8 text-center")],
		[IconMagnifier3(h, { className: "mb-3 size-8 text-muted-fg/50" }), h.p([h.Class("text-muted-fg text-sm")], [message])],
	)

const footer = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex-none border-t px-2 py-1.5 text-muted-fg text-xs")],
		[
			h.span([], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["↑"]), h.kbd([h.Class(`mr-2 ${KBD}`)], ["↓"]), "to navigate"]),
			h.span([h.Class("ml-3")], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["↵"]), "to select"]),
			h.span([h.Class("ml-3")], [h.kbd([h.Class(`mx-1 ${KBD}`)], ["esc"]), "to go back"]),
		],
	)

/** `SearchFilterChipGroup`. */
const filterChips = (h: HtmlBuilder<Message>, page: SearchPage): Html[] =>
	page.filters.length === 0
		? []
		: [
				h.div(
					[h.Class("flex flex-wrap items-center gap-1")],
					page.filters.map((filter, index) => {
						const label = getFilterTypeLabel(filter.type)
						return h.span(
							[h.Class(cn("inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs", "ring-1 ring-inset ring-border"))],
							[
								h.span([h.Class("text-muted-fg")], [`${label}:`]),
								h.span([h.Class("font-medium text-fg")], [filter.displayValue]),
								h.button(
									[
										h.Type("button"),
										h.Attribute("aria-label", `Remove ${label} filter`),
										h.Class(
											"ml-0.5 rounded p-0.5 text-muted-fg transition-colors hover:bg-muted hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										),
										h.OnClick(Message.ClickedRemoveFilter({ index })),
									],
									[IconClose(h, { className: "size-3" })],
								),
							],
						)
					}),
				),
			]

const AUTOCOMPLETE_TITLES = { from: "Select a user", in: "Select a channel", has: "Select attachment type" } as const

/** The `filter:` autocomplete dropdown; mousedown is prevented so the editor keeps focus. */
const autocompletePopover = (h: HtmlBuilder<Message>, model: Model): Html[] => {
	const autocomplete = model.searchAutocomplete
	if (autocomplete === null || model.suggestions.length === 0) return []
	return [
		h.div(
			[
				h.Class(
					"fade-in slide-in-from-top-2 animate-in absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-fg/10 bg-overlay text-overlay-fg shadow-lg duration-150",
				),
			],
			[
				h.div([h.Class("border-b border-fg/5 px-3 py-2 text-muted-fg text-xs")], [AUTOCOMPLETE_TITLES[autocomplete.filterType]]),
				h.div(
					[h.Class("p-1")],
					model.suggestions.map((option, index) =>
						h.keyed("button")(
							option.id,
							[
								h.Type("button"),
								h.Class(
									cn(
										"flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
										index === model.suggestionIndex ? "bg-primary/10 text-primary" : "hover:bg-muted",
									),
								),
								h.OnMouseDown(Message.ClickedSuggestion({ index })),
								h.OnMouseEnter(Message.HoveredSuggestion({ index })),
							],
							[
								...(option.kind === "user"
									? [avatar(h, { size: "xs", src: option.avatarUrl, alt: option.label, seed: option.label })]
									: []),
								...(option.kind === "channel" ? [IconHashtag(h, { className: "size-4 text-muted-fg" })] : []),
								h.span([h.Class("truncate font-medium")], [option.label]),
							],
						),
					),
				),
			],
		),
	]
}

const recentSearches = (h: HtmlBuilder<Message>, model: Model, page: SearchPage, nowMs: number): Html =>
	h.div(
		[h.Class("space-y-1")],
		[
			h.div(
				[h.Class("flex items-center justify-between px-2 py-1")],
				[
					h.span([h.Class("text-muted-fg text-xs")], ["Recent searches"]),
					h.button(
						[
							h.Type("button"),
							h.Class("text-muted-fg text-xs transition-colors hover:text-fg"),
							h.OnClick(Message.ClickedClearRecentSearches()),
						],
						["Clear all"],
					),
				],
			),
			...model.recentSearches.map((search, index) =>
				h.button(
					[
						h.Type("button"),
						h.Class(
							cn(
								"flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary",
								index === page.selectedIndex && "bg-secondary",
							),
						),
						h.OnClick(Message.ClickedRecentSearch({ index })),
					],
					[
						h.span(
							[h.Class("flex min-w-0 flex-1 flex-wrap items-center gap-1")],
							[
								...search.filters.map((filter) =>
									h.span(
										[h.Class("inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-xs ring-1 ring-inset ring-border")],
										[h.span([h.Class("text-muted-fg")], [`${filter.type}:`]), h.span([h.Class("font-medium text-fg")], [filter.displayValue])],
									),
								),
								...(search.query ? [h.span([h.Class("truncate text-fg")], [search.query])] : []),
							],
						),
						h.span(
							[h.Class("shrink-0 text-muted-fg text-xs")],
							[formatDistanceToNow(Math.min(search.timestamp, nowMs), nowMs)],
						),
					],
				),
			),
		],
	)

const content = (h: HtmlBuilder<Message>, model: Model, page: SearchPage, nowMs: number): Html[] => {
	const { hasQuery, results } = model.search
	if (hasQuery)
		return results.length > 0
			? [
					h.div(
						[h.Class("space-y-1")],
						results.map((result, index) => searchResultItem(h, result, page.query, index === page.selectedIndex, index, nowMs)),
					),
				]
			: [emptyState(h, "No messages found matching your search")]
	return model.recentSearches.length > 0
		? [recentSearches(h, model, page, nowMs)]
		: [emptyState(h, "Start typing to search messages across all channels")]
}

/** `nowMs` is the root's clock: relative times never read `Date.now()` in the view. */
export const searchPage = (h: HtmlBuilder<Message>, model: Model, page: SearchPage, nowMs: number): Html =>
	h.div(
		[h.Class("flex max-h-[inherit] flex-col overflow-hidden")],
		[
			h.div(
				[h.Class("flex items-center gap-2 border-b px-2.5 py-1")],
				[
					IconMagnifier3(h, { className: "size-5 shrink-0 text-muted-fg" }),
					...filterChips(h, page),
					h.div(
						[h.Class("relative min-w-0 flex-1")],
						[
							h.keyed("div")("search-editor", [h.OnMount(MountSearchEditor({ placeholder: searchPlaceholder(page) }))], []),
							...autocompletePopover(h, model),
						],
					),
					...(page.rawInput || page.filters.length > 0
						? [
								h.button(
									[
										h.Type("button"),
										h.Attribute("aria-label", "Clear search"),
										h.Class("rounded p-1 text-muted-fg transition-colors hover:bg-secondary hover:text-fg"),
										h.OnClick(Message.ClickedClearSearch()),
									],
									[IconClose(h, { className: "size-4" })],
								),
							]
						: []),
				],
			),
			h.div([h.Class("flex-1 overflow-y-auto p-2")], content(h, model, page, nowMs)),
			footer(h),
		],
	)
