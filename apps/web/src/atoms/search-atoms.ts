import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

export const MAX_RECENT_SEARCHES = 10

/**
 * Schema for a resolved search filter
 */
const SearchFilterSchema = Schema.Struct({
	type: Schema.Literals(["from", "in", "has", "before", "after"]),
	value: Schema.String,
	displayValue: Schema.String,
	id: Schema.String,
})

/**
 * Schema for a saved recent search
 */
const RecentSearchSchema = Schema.Struct({
	query: Schema.String,
	filters: Schema.Array(SearchFilterSchema),
	timestamp: Schema.Number,
})

export type RecentSearch = typeof RecentSearchSchema.Type

/**
 * Schema for the array of recent searches
 */
const RecentSearchesSchema = Schema.Array(RecentSearchSchema)

/**
 * Atom that stores recent searches in localStorage
 * This is persisted separately from the command palette state
 * because recent searches should persist across sessions
 */
export const recentSearchesAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "recentSearches",
	schema: Schema.toCodecIso(RecentSearchesSchema),
	defaultValue: () => [] as RecentSearch[],
}).pipe(Atom.keepAlive)
