import { modifyFields } from "foldkit/struct"
import { parseSearchInput } from "~/lib/search-filter-parser"
import type { Shared } from "../../page/contract"
import type { Message } from "./message"
import type { Model } from "./model"
import type { Return } from "./update"

/** The search page's handlers (`SearchView`): input parsing, filters, selection. */

type SearchMessage = Extract<
	Message,
	{
		_tag:
			| "ChangedSearchInput"
			| "SelectedSearchFilter"
			| "ClickedRemoveFilter"
			| "PressedSearchKey"
			| "ClickedClearSearch"
			| "ClickedSearchResult"
			| "ClickedRecentSearch"
			| "ClickedClearRecentSearches"
	}
>

export const updateSearch = (model: Model, message: SearchMessage, _shared: Shared): Return => {
	const page = model.page
	if (page._tag !== "Search") return { model }
	if (message._tag === "ChangedSearchInput") {
		const parsed = parseSearchInput(message.value)
		return {
			model: modifyFields(model, {
				page: () => ({ ...page, rawInput: message.value, query: parsed.textQuery, selectedIndex: 0 }),
			}),
		}
	}
	return { model }
}
