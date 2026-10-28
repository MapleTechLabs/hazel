import type { MessageSearchPayload, MessageSearchResponse } from "@hazel/domain/rpc"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Duration, Effect, Stream } from "effect"
import { catchCommon } from "../../data/actions"
import { parseDateFilter } from "~/lib/search-filter-parser"
import { HazelRpc } from "../../rpc"
import type { SearchFilter, SearchResult } from "./search-data"

/**
 * `message.search` for the palette: the org's server-side index, which covers every channel the
 * user can read, not only the ones loaded this session. Its hits are merged with the instant local
 * results (`search-subscription.ts`).
 */

/** Typing pause before the request goes out (each keystroke restarts the stream). */
export const SERVER_SEARCH_DELAY = Duration.millis(250)
export const SEARCH_LIMIT = 50

type Hit = MessageSearchResponse["results"][number]

/** The request for the page's text and filters; `null` when the server cannot answer it. */
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

const dateOf = (filter: SearchFilter | undefined) => (filter ? parseDateFilter(filter.value) : null)

/** Debounced `message.search`: `null` while waiting, then the hits, or `[]` when it failed. */
export const serverSearchStream = (
	request: MessageSearchPayload | null,
): Stream.Stream<ReadonlyArray<Hit> | null, never, HazelRpc> =>
	request === null
		? Stream.succeed([])
		: Stream.concat(
				Stream.succeed(null),
				Stream.fromEffect(
					Effect.sleep(SERVER_SEARCH_DELAY).pipe(
						Effect.andThen(HazelRpc.use((rpc) => rpc("message.search", request))),
						Effect.map((response): ReadonlyArray<Hit> => response.results),
						catchCommon((): ReadonlyArray<Hit> => []),
						Effect.withSpan("CommandPalette.serverSearch"),
					),
				),
			)

export interface HitLookup {
	readonly authorOf: (hit: Hit) => {
		readonly name: string
		readonly avatarUrl: string | null
	} | null
	readonly channelNameOf: (channelId: ChannelId) => string | null
}

/**
 * Local results (full rows of loaded channels) and server hits (snippets), newest first, one row per
 * message: a loaded message keeps its local row.
 */
export const mergeSearchResults = (
	local: ReadonlyArray<SearchResult>,
	hits: ReadonlyArray<Hit>,
	lookup: HitLookup,
): ReadonlyArray<SearchResult> => {
	const byId = new Map<string, SearchResult>()
	for (const hit of hits) {
		const author = lookup.authorOf(hit)
		byId.set(hit.messageId, {
			messageId: hit.messageId,
			channelId: hit.channelId,
			content: hit.snippet,
			createdAtMs: hit.createdAt.getTime(),
			authorName: author?.name ?? "Unknown",
			authorAvatarUrl: author?.avatarUrl ?? null,
			channelName: lookup.channelNameOf(hit.channelId),
			attachmentCount: 0,
		})
	}
	for (const result of local) byId.set(result.messageId, result)
	return [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, SEARCH_LIMIT)
}
