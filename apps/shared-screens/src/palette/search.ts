/**
 * Message search without the UI: the typed filter's autocomplete, the server request, how local rows
 * and server hits merge, and the recent searches (from today's `search-update.ts` and `server-search.ts`).
 */
import type { MessageSearchPayload, MessageSearchResponse } from "@hazel/domain/rpc"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { HAS_FILTER_VALUES, parseDateFilter, parseSearchInput } from "../lib/search-filter-parser"
import type { RecentSearch, SearchFilter, SearchResult, Suggestion } from "./model"

export const SEARCH_LIMIT = 50
export const MAX_RECENT_SEARCHES = 10

/** The `from:`, `in:` or `has:` being typed at the end of the query, if any. */
export interface Autocomplete {
	readonly filterType: "from" | "in" | "has"
	readonly search: string
	/** Where `filter:partial` starts in the text, so picking a value can drop it. */
	readonly start: number
}

const TRIGGER_PATTERN = /\b(from|in|has|before|after):([^:\s]*)$/i

// HAZEL-GAP(p4-palette-query-editor): today's editor reads the caret; the palette field has none, so the trigger is the text's end.
export const autocompleteOf = (text: string): Autocomplete | null => {
	const match = TRIGGER_PATTERN.exec(text)
	const filterType = match?.[1]?.toLowerCase()
	return match !== null && (filterType === "from" || filterType === "in" || filterType === "has")
		? { filterType, search: match[2] ?? "", start: match.index }
		: null
}

/** The words to search for: the text without its filter syntax. */
export const textQueryOf = (text: string) => parseSearchInput(text).textQuery

export const hasQuery = (text: string, filters: ReadonlyArray<SearchFilter>) =>
	textQueryOf(text).trim().length > 0 || filters.length > 0

/** Picking a suggestion: the typed `filter:partial` goes, and the filter joins the others. */
export const pickSuggestion = (
	text: string,
	filters: ReadonlyArray<SearchFilter>,
	autocomplete: Autocomplete,
	suggestion: Suggestion,
): { readonly text: string; readonly filters: ReadonlyArray<SearchFilter> } => ({
	text: text.slice(0, autocomplete.start).trimEnd(),
	filters: [
		...filters,
		{
			type: autocomplete.filterType,
			value: suggestion.label,
			displayValue: suggestion.label,
			id: suggestion.id,
		},
	],
})

/** `has:` values matching what is typed after it. */
export const hasSuggestions = (search: string): ReadonlyArray<Suggestion> =>
	HAS_FILTER_VALUES.filter((value) => value.toLowerCase().includes(search.toLowerCase())).map((value) => ({
		id: value,
		label: value,
		avatarUrl: null,
		kind: "has" as const,
	}))

const dateOf = (filter: SearchFilter | undefined) => (filter ? parseDateFilter(filter.value) : null)

/** The request for the query and filters; `null` when the server cannot answer it. */
export const toSearchRequest = (
	organizationId: OrganizationId,
	query: string,
	filters: ReadonlyArray<SearchFilter>,
): MessageSearchPayload | null => {
	const find = (type: SearchFilter["type"]) => filters.find((filter) => filter.type === type)
	// `has:` needs attachments and embeds, which the index does not hold: local results only.
	if (find("has") !== undefined) return null
	const text = query.trim()
	if (text.length === 0 && filters.length === 0) return null
	const before = dateOf(find("before"))
	const after = dateOf(find("after"))
	const from = find("from")
	const inChannel = find("in")
	return {
		organizationId,
		query: text.slice(0, 500),
		...(from === undefined ? {} : { authorId: from.id as UserId }),
		...(inChannel === undefined ? {} : { channelId: inChannel.id as ChannelId }),
		...(before === null ? {} : { before }),
		...(after === null ? {} : { after }),
		limit: SEARCH_LIMIT,
	}
}

export type Hit = MessageSearchResponse["results"][number]

export interface HitLookup {
	readonly authorOf: (hit: Hit) => { readonly name: string; readonly avatarUrl: string | null } | null
	readonly channelNameOf: (channelId: ChannelId) => string | null
}

/** A server hit as a result row, with the names the loaded rows know. */
export const resultOfHit = (hit: Hit, lookup: HitLookup): SearchResult => {
	const author = lookup.authorOf(hit)
	return {
		messageId: hit.messageId,
		channelId: hit.channelId,
		content: hit.snippet,
		createdAtMs: hit.createdAt.getTime(),
		authorName: author?.name ?? "Unknown",
		authorAvatarUrl: author?.avatarUrl ?? null,
		channelName: lookup.channelNameOf(hit.channelId),
		attachmentCount: 0,
	}
}

/** Local rows and server hits, newest first, one row per message: a loaded message keeps its row. */
export const mergeSearchResults = (
	local: ReadonlyArray<SearchResult>,
	server: ReadonlyArray<SearchResult>,
): ReadonlyArray<SearchResult> => {
	const byId = new Map<string, SearchResult>()
	for (const result of server) byId.set(result.messageId, result)
	for (const result of local) byId.set(result.messageId, result)
	return [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, SEARCH_LIMIT)
}

/** `filter:value` as typed, quoted when the value has a space. */
export const filterString = (filters: ReadonlyArray<SearchFilter>) =>
	filters
		.map((filter) => `${filter.type}:${filter.value.includes(" ") ? `"${filter.value}"` : filter.value}`)
		.join(" ")

/** A search the user opened a result of goes first; the same search further down goes. */
export const rememberSearch = (
	recent: ReadonlyArray<RecentSearch>,
	search: RecentSearch,
): ReadonlyArray<RecentSearch> =>
	[
		search,
		...recent.filter(
			(entry) =>
				entry.query !== search.query ||
				JSON.stringify(entry.filters) !== JSON.stringify(search.filters),
		),
	].slice(0, MAX_RECENT_SEARCHES)

const truncate = (content: string, maxLength = 120) =>
	content.length <= maxLength ? content : `${content.slice(0, maxLength).trim()}...`

const MARKERS = /(\*\*|~~|__|==|`)([^*~_=`]+)\1|([*_])([^*_]+)\3/g

/** A result's text without its markdown markers, cut to one preview line. */
export const previewOf = (content: string) =>
	truncate(content.replace(MARKERS, (_, _a, inner, _b, single) => inner ?? single ?? ""))
