import { ChannelId, MessageId } from "@hazel/schema"
import { Schema } from "effect"

export const FilterType = Schema.Literals(["from", "in", "has", "before", "after"])
export type FilterType = typeof FilterType.Type

/** `lib/search-filter-parser.ts` SearchFilter, as `recentSearchesAtom` stores it. */
export const SearchFilter = Schema.Struct({
	type: FilterType,
	value: Schema.String,
	displayValue: Schema.String,
	id: Schema.String,
})
export type SearchFilter = typeof SearchFilter.Type

/** The search page's live data (`useSearchQuery`, `recentSearchesAtom`), owned by the palette Model. */

export const SearchResult = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	content: Schema.String,
	createdAtMs: Schema.Number,
	authorName: Schema.String,
	authorAvatarUrl: Schema.NullOr(Schema.String),
	channelName: Schema.NullOr(Schema.String),
	attachmentCount: Schema.Number,
})
export type SearchResult = typeof SearchResult.Type

export const RecentSearch = Schema.Struct({
	query: Schema.String,
	filters: Schema.Array(SearchFilter),
	timestamp: Schema.Number,
})
export type RecentSearch = typeof RecentSearch.Type

export const SearchData = Schema.Struct({
	results: Schema.Array(SearchResult),
	isLoading: Schema.Boolean,
	/** `shouldSearch`: there is text or a filter, and a channel to search in. */
	hasQuery: Schema.Boolean,
})
export type SearchData = typeof SearchData.Type

export const emptySearchData: SearchData = { results: [], isLoading: false, hasQuery: false }
