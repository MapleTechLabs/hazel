import { Match } from "effect"
import { modifyFields } from "foldkit/struct"
import { parseSearchInput } from "~/lib/search-filter-parser"
import type { Shared } from "../../page/contract"
import { chatMessageHref } from "../../route"
import type { Message } from "./message"
import type { Model, PageState } from "./model"
import type { SearchFilter, Suggestion } from "./search-data"
import {
	DeleteFilterText,
	FocusSearchEditor,
	SaveRecentSearches,
	SetSearchPlaceholder,
	SetSearchText,
	SyncSuggestionCount,
} from "./search-mount"
import { closedWith, type Return } from "./update"

/** `SearchView` and `SearchSlateEditor` handlers: parsing, filters, selection, recent searches. */

type SearchMessage = Extract<
	Message,
	{
		_tag:
			| "EditedSearch"
			| "PressedSearchKey"
			| "PressedAutocompleteKey"
			| "HoveredSuggestion"
			| "ClickedSuggestion"
			| "UpdatedSuggestions"
			| "ClickedRemoveFilter"
			| "ClickedClearSearch"
			| "ClickedSearchResult"
			| "ClickedRecentSearch"
			| "ClickedClearRecentSearches"
	}
>
type SearchPage = Extract<PageState, { _tag: "Search" }>
type SearchKey = Extract<SearchMessage, { _tag: "PressedSearchKey" }>["key"]

const MAX_RECENT_SEARCHES = 10

export const searchPlaceholder = (page: SearchPage) =>
	page.filters.length > 0
		? "Add more filters or search..."
		: "Search messages... (from:user in:channel has:image)"

const withPage = (model: Model, page: SearchPage): Model => modifyFields(model, { page: () => page })

/** Filters changed: the placeholder follows, and focus goes back to the editor. */
const withFilters = (model: Model, page: SearchPage, filters: ReadonlyArray<SearchFilter>): Return => {
	const next = modifyFields(page, { filters: () => filters, selectedIndex: () => 0 })
	return {
		model: withPage(model, next),
		commands: [SetSearchPlaceholder({ placeholder: searchPlaceholder(next) }), FocusSearchEditor()],
	}
}

/** `selectOption`: drop the typed filter text and add the chosen filter with its entity id. */
const selectSuggestion = (model: Model, page: SearchPage, suggestion: Suggestion | undefined): Return => {
	const autocomplete = model.searchAutocomplete
	if (suggestion === undefined || autocomplete === null) return { model }
	const filter = {
		type: autocomplete.filterType,
		value: suggestion.label,
		displayValue: suggestion.label,
		id: suggestion.id,
	}
	const result = withFilters(modifyFields(model, { searchAutocomplete: () => null }), page, [
		...page.filters,
		filter,
	])
	return {
		...result,
		commands: [
			DeleteFilterText({ filterStartOffset: autocomplete.filterStartOffset }),
			...(result.commands ?? []),
		],
	}
}

const filterString = (filters: ReadonlyArray<SearchFilter>) =>
	filters
		.map((filter) => `${filter.type}:${filter.value.includes(" ") ? `"${filter.value}"` : filter.value}`)
		.join(" ")

/** `navigateToResult`: remember the search, open the message in its channel, close. */
const openResult = (model: Model, page: SearchPage, index: number, shared: Shared): Return => {
	const result = model.search.results[index]
	if (result === undefined) return { model }
	const search = { query: page.query, filters: page.filters, timestamp: shared.nowMs }
	const recent = model.search.hasQuery
		? [
				search,
				...model.recentSearches.filter(
					(entry) =>
						entry.query !== search.query ||
						JSON.stringify(entry.filters) !== JSON.stringify(search.filters),
				),
			].slice(0, MAX_RECENT_SEARCHES)
		: model.recentSearches
	const closed = closedWith(
		modifyFields(model, { recentSearches: () => recent }),
		shared.orgSlug === null ? null : chatMessageHref(shared.orgSlug, result.channelId, result.messageId),
		null,
	)
	return { ...closed, commands: model.search.hasQuery ? [SaveRecentSearches({ searches: recent })] : [] }
}

/** `loadRecentSearch`: restore its filters and text in the page and the editor. */
const loadRecent = (model: Model, page: SearchPage, index: number): Return => {
	const recent = model.recentSearches[index]
	if (recent === undefined) return { model }
	const rawInput = [filterString(recent.filters), recent.query].filter(Boolean).join(" ")
	const next = modifyFields(page, {
		query: () => recent.query,
		rawInput: () => rawInput,
		filters: () => recent.filters,
		selectedIndex: () => 0,
	})
	return {
		model: withPage(model, next),
		commands: [
			SetSearchText({ text: rawInput }),
			SetSearchPlaceholder({ placeholder: searchPlaceholder(next) }),
		],
	}
}

const moveSelection = (model: Model, page: SearchPage, step: 1 | -1): Return => {
	const count = model.search.hasQuery ? model.search.results.length : model.recentSearches.length
	if (step === 1 && count === 0) return { model }
	const selectedIndex =
		step === 1 ? Math.min(page.selectedIndex + 1, count - 1) : Math.max(page.selectedIndex - 1, 0)
	return { model: withPage(model, modifyFields(page, { selectedIndex: () => selectedIndex })) }
}

const pressedAutocompleteKey = (model: Model, page: SearchPage, key: string): Return => {
	const count = model.suggestions.length
	if (key === "Escape") return { model: modifyFields(model, { searchAutocomplete: () => null }) }
	if (key === "Enter" || key === "Tab")
		return selectSuggestion(model, page, model.suggestions[model.suggestionIndex])
	const suggestionIndex =
		key === "ArrowDown"
			? (model.suggestionIndex + 1) % count
			: model.suggestionIndex <= 0
				? count - 1
				: model.suggestionIndex - 1
	return { model: modifyFields(model, { suggestionIndex: () => suggestionIndex }) }
}

const editedSearch = (
	model: Model,
	page: SearchPage,
	message: Extract<SearchMessage, { _tag: "EditedSearch" }>,
) => {
	const isSameTrigger = model.searchAutocomplete?.filterType === message.autocomplete?.filterType
	const next = modifyFields(page, {
		rawInput: () => message.text,
		query: () => parseSearchInput(message.text).textQuery,
		selectedIndex: () => 0,
	})
	return {
		model: modifyFields(withPage(model, next), {
			searchAutocomplete: () => message.autocomplete,
			suggestionIndex: (index) => (message.autocomplete !== null && isSameTrigger ? index : 0),
		}),
	}
}

const pressedSearchKey = (model: Model, page: SearchPage, key: SearchKey, shared: Shared): Return =>
	Match.value(key).pipe(
		Match.withReturnType<Return>(),
		Match.when("ArrowDown", () => moveSelection(model, page, 1)),
		Match.when("ArrowUp", () => moveSelection(model, page, -1)),
		Match.when("BackspaceAtStart", () =>
			page.filters.length > 0 ? withFilters(model, page, page.filters.slice(0, -1)) : { model },
		),
		Match.when("Enter", () =>
			model.search.hasQuery
				? openResult(model, page, page.selectedIndex, shared)
				: loadRecent(model, page, page.selectedIndex),
		),
		Match.exhaustive,
	)

const updatedSuggestions = (model: Model, suggestions: ReadonlyArray<Suggestion>): Return => {
	const count = suggestions.length
	return {
		model: modifyFields(model, {
			suggestions: () => suggestions,
			// The legacy clamp effect: keep the active option inside the list.
			suggestionIndex: (index) => (count > 0 && index >= count ? count - 1 : index),
		}),
		commands: [SyncSuggestionCount({ count })],
	}
}

const clearedSearch = (model: Model, page: SearchPage): Return => {
	const next = modifyFields(page, {
		query: () => "",
		rawInput: () => "",
		filters: () => [],
		selectedIndex: () => 0,
	})
	return {
		model: withPage(model, next),
		commands: [
			SetSearchText({ text: "" }),
			SetSearchPlaceholder({ placeholder: searchPlaceholder(next) }),
		],
	}
}

const searchStep = (model: Model, page: SearchPage, message: SearchMessage, shared: Shared): Return =>
	Match.valueTags(message, {
		EditedSearch: (edited): Return => editedSearch(model, page, edited),
		PressedSearchKey: ({ key }) => pressedSearchKey(model, page, key, shared),
		PressedAutocompleteKey: ({ key }) => pressedAutocompleteKey(model, page, key),
		HoveredSuggestion: ({ index }): Return => ({
			model: modifyFields(model, { suggestionIndex: () => index }),
		}),
		ClickedSuggestion: ({ index }) => selectSuggestion(model, page, model.suggestions[index]),
		UpdatedSuggestions: ({ suggestions }) => updatedSuggestions(model, suggestions),
		ClickedRemoveFilter: ({ index }) =>
			withFilters(
				model,
				page,
				page.filters.filter((_, filterIndex) => filterIndex !== index),
			),
		ClickedClearSearch: () => clearedSearch(model, page),
		ClickedSearchResult: ({ index }) => openResult(model, page, index, shared),
		ClickedRecentSearch: ({ index }) => loadRecent(model, page, index),
		ClickedClearRecentSearches: (): Return => ({
			model: modifyFields(model, { recentSearches: () => [] }),
			commands: [SaveRecentSearches({ searches: [] })],
		}),
	})

export const updateSearch = (model: Model, message: SearchMessage, shared: Shared): Return =>
	model.page._tag === "Search" ? searchStep(model, model.page, message, shared) : { model }
