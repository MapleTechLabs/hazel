/**
 * Message search inside an `OrgObject`: an FTS5 index (`message_search`, `message_search_fts`,
 * migration `0002_message_search`) over the org's channels' messages, queried by
 * `message.search` and filtered by the caller's `channel_access` here.
 *
 * - Feed: each `ChannelObject` sends `org.indexMessages` on message create, update and delete
 *   (`../channel/search-index.ts`); rows are indexed under the sending channel's id (a Connect
 *   guest's message in a host channel carries its mount's id, the index the host channel's).
 * - Connect: the host org passes each host channel change to the guest orgs
 *   (`org.indexConnectMessages`), indexed there under the guest's mounted channel, so guests
 *   search their own org and see what their `channel_access` there allows.
 * - Backfill: an object whose index predates `SEARCH_INDEX_VERSION` (every org that existed before
 *   search shipped) runs `reindexMessageSearch` when it activates: each channel is asked for its
 *   messages page by page through the outbox (`channel.exportSearchMessages`), progress per
 *   channel in `message_search_backfill`. Searches answer `indexing: true` until every channel has
 *   sent its last page. A fresh object starts at the current version with nothing to fill.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import { type MessageSearchHit, type MessageSearchPayload, MessageSearchResponse } from "@hazel/domain/rpc"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { currentObject } from "../../../lib/current-object"
import { CurrentEffectSender, enqueueEffect, type EffectSender } from "../effects/registry"
import { channelTarget, orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import {
	type IndexConnectMessagesPayload,
	type IndexedMessage,
	type IndexMessagesPayload,
	SearchChannelEffects,
	type SearchGuest,
	SearchOrgEffects,
} from "../search-wire"

/** Bump to rebuild every org's index from its channels (a change to what or how it indexes). */
export const SEARCH_INDEX_VERSION = "1"
const VERSION_KEY = "messageSearchVersion"

/** The org migration that creates the index; optional, so an org serves without it. */
export const SEARCH_MIGRATION_ID = "0002_message_search"

/**
 * Whether the index exists: its migration may have failed on this activation (and retries on the
 * next). Without it, index writes are dropped (the activation that creates it backfills).
 */
export const searchAvailable = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.sqliteMasterTable)
			.select("name")
			.where(($) => [
				$.type.eq("table"),
				$.name.in_("message_search", "message_search_fts", "message_search_backfill"),
			]),
	)
	return rows.length === 3
})

const DEFAULT_LIMIT = 50
const SNIPPET_TOKENS = 24
const PREVIEW_CHARS = 240

const MENTION = /@\[(userId|directive):([^\]]+)\]/g
// Snippet markers: control characters, stripped from indexed text.
const MARK_START = "\u0002"
const MARK_END = "\u0003"

/**
 * Message markdown as searchable plain text: mentions become `@First Last` (or `@channel`),
 * links keep their text and url, emphasis, code and quote markers go.
 */
export const toSearchText = (content: string, nameOf: (userId: string) => string | undefined) =>
	content
		.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")
		.replace(MENTION, (_, prefix: string, value: string) => {
			if (prefix === "directive") return `@${value}`
			const name = nameOf(value)
			return name === undefined ? " " : `@${name}`
		})
		.replace(/!?\[([^\]]*)\]\(([^)\s]*)\)/g, "$1 $2")
		.replace(/```[^\n]*/g, " ")
		.replace(/\*\*|__|~~|\|\||`/g, "")
		.replace(/^[ \t]{0,3}(#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, "")
		.replace(/\s+/g, " ")
		.trim()

const mentionedUserIds = (messages: ReadonlyArray<IndexedMessage>) => {
	const ids = new Set<UserId>()
	for (const message of messages) {
		for (const match of message.content.matchAll(MENTION)) {
			if (match[1] === "userId") ids.add(match[2] as UserId)
		}
	}
	return [...ids]
}

/** Display names of the users the batch mentions, from the org's `users` projection. */
const namesFor = Effect.fn("OrgObject.searchMentionNames")(function* (
	messages: ReadonlyArray<IndexedMessage>,
) {
	const ids = mentionedUserIds(messages)
	if (ids.length === 0) return new Map<string, string>()
	const db = yield* Database.Database
	const users = yield* db.run(
		SQLite.from(schema.usersTable)
			.select("id", "firstName", "lastName")
			.where(($) => [$.id.in_(...ids)]),
	)
	return new Map<string, string>(
		users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
	)
})

/** Apply index changes for one channel (as this org names it). */
const applyIndex = Effect.fn("OrgObject.applySearchIndex")(function* (
	channelId: ChannelId,
	change: {
		readonly upsert: ReadonlyArray<IndexedMessage>
		readonly remove: ReadonlyArray<MessageId>
		readonly replace: boolean
	},
) {
	if (!(yield* searchAvailable)) return
	const db = yield* Database.Database
	if (change.replace) {
		yield* db.run(SQLite.deleteFrom(schema.messageSearchTable).where(($) => [$.channelId.eq(channelId)]))
	}
	if (change.remove.length > 0) {
		yield* db.run(
			SQLite.deleteFrom(schema.messageSearchTable).where(($) => [
				$.channelId.eq(channelId),
				$.messageId.in_(...change.remove),
			]),
		)
	}
	const names = yield* namesFor(change.upsert)
	for (const message of change.upsert) {
		yield* db.run(
			SQLite.insertInto(schema.messageSearchTable)
				.values({
					messageId: message.id,
					channelId,
					authorId: message.authorId,
					conversationId: message.conversationId,
					createdAt: message.createdAt,
					content: toSearchText(message.content, (id) => names.get(id)),
				})
				.onConflictDoUpdate({ target: ["messageId"], set: SQLite.excludedAll() }),
		)
	}
	yield* Effect.annotateCurrentSpan({
		"search.upserted": change.upsert.length,
		"search.removed": change.remove.length,
		"search.replace": change.replace,
	})
})

const localChannel = (channelId: string) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.channelsTable)
				.select("id", "deletedAt")
				.where(($) => [$.id.eq(ChannelId.make(channelId))])
				.limit(1),
		),
	)

/** Host: pass a host channel's index change to each guest org (or `only` it), under its mount. */
const forwardToGuests = Effect.fn("OrgObject.forwardSearchToGuests")(function* (
	channelId: ChannelId,
	change: Omit<IndexConnectMessagesPayload, "conversationId" | "channelId">,
	only?: SearchGuest,
) {
	const db = yield* Database.Database
	const mount = yield* db.first(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("conversationId", "role")
			.where(($) => [$.channelId.eq(channelId), $.isActive.eq(true), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isNone(mount) || mount.value.role !== "host") return
	const conversationId = mount.value.conversationId
	const guests = yield* db.run(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("organizationId", "channelId")
			.where(($) => [
				$.conversationId.eq(conversationId),
				$.role.eq("guest"),
				$.isActive.eq(true),
				$.deletedAt.isNull(),
			]),
	)
	yield* Effect.forEach(
		only === undefined
			? guests
			: guests.filter(
					(guest) =>
						guest.organizationId === only.organizationId && guest.channelId === only.channelId,
				),
		(guest) =>
			enqueueEffect(
				SearchOrgEffects.indexConnectMessages,
				orgTarget(guest.organizationId) as { kind: "org"; id: string },
				{ ...change, conversationId, channelId: guest.channelId },
			),
		{ discard: true },
	)
})

/** `org.indexMessages` from one of this org's channels; a backfill page asks for the next. */
export const indexMessages = Effect.fn("OrgObject.indexMessages")(function* (payload: IndexMessagesPayload) {
	const sender = yield* Effect.serviceOption(CurrentEffectSender)
	if (Option.isNone(sender) || sender.value.kind !== "channel") return
	if (!(yield* searchAvailable)) return
	const channelId = ChannelId.make(sender.value.id)
	const channel = yield* localChannel(channelId)
	if (Option.isNone(channel) || channel.value.deletedAt !== null) {
		// Gone since the backfill asked: nothing left to wait for.
		const db = yield* Database.Database
		yield* db.run(
			SQLite.deleteFrom(schema.messageSearchBackfillTable).where(($) => [$.channelId.eq(channelId)]),
		)
		return
	}
	const change = {
		upsert: payload.upsert,
		remove: payload.remove,
		replace: payload.page?.replace ?? false,
	}
	const page = payload.page
	// A page for one new guest: only it is filled; this org's index already holds the messages.
	if (page?.guest !== undefined) {
		yield* forwardToGuests(channelId, change, page.guest)
		if (page.next === null) return
		return yield* enqueueEffect(
			SearchChannelEffects.exportSearchMessages,
			channelTarget(channelId) as { kind: "channel"; id: string },
			{ generation: page.generation, after: page.next, guest: page.guest },
		)
	}
	yield* applyIndex(channelId, change)
	yield* forwardToGuests(channelId, change)

	if (page === undefined) return
	const db = yield* Database.Database
	const backfill = yield* db.first(
		SQLite.from(schema.messageSearchBackfillTable)
			.select("generation")
			.where(($) => [$.channelId.eq(channelId)]),
	)
	// A page of an earlier backfill: its rows still count, its chain does not continue.
	if (Option.isNone(backfill) || backfill.value.generation !== page.generation) return
	if (page.next === null) {
		yield* db.run(
			SQLite.update(schema.messageSearchBackfillTable)
				.set({ done: true })
				.where(($) => [$.channelId.eq(channelId)]),
		)
		return
	}
	yield* enqueueEffect(
		SearchChannelEffects.exportSearchMessages,
		channelTarget(channelId) as { kind: "channel"; id: string },
		{ generation: page.generation, after: page.next },
	)
})

/** Guest: a host channel's change, for this org's mount of it. */
export const indexConnectMessages = Effect.fn("OrgObject.indexConnectMessages")(function* (
	payload: IndexConnectMessagesPayload,
) {
	yield* applyIndex(payload.channelId, payload)
})

/** Host: send a new guest the host channel's history, page by page, under its mount. */
export const exportToGuest = Effect.fn("OrgObject.exportSearchToGuest")(function* (
	hostChannelId: ChannelId,
	guest: SearchGuest,
) {
	yield* enqueueEffect(
		SearchChannelEffects.exportSearchMessages,
		channelTarget(hostChannelId) as { kind: "channel"; id: string },
		{ generation: yield* Clock.currentTimeMillis, after: null, guest },
	)
})

/** Guest: the mount ended; what it indexed from the host channel goes. */
export const dropMountedSearch = Effect.fn("OrgObject.dropMountedSearch")(function* (channelId: ChannelId) {
	if (!(yield* searchAvailable)) return
	const db = yield* Database.Database
	yield* db.run(SQLite.deleteFrom(schema.messageSearchTable).where(($) => [$.channelId.eq(channelId)]))
})

export const messageSearchOrgReceivers = {
	"org.indexMessages": indexMessages,
	"org.indexConnectMessages": indexConnectMessages,
}

/**
 * Who may change this org's index: `org.indexMessages` only from a channel of this org,
 * `org.indexConnectMessages` only from the host org of the conversation the mount belongs to.
 * Other kinds pass. `Some(reason)` refuses.
 */
export const searchSenderRefusal = Effect.fn("OrgObject.searchSenderRefusal")(function* (
	kind: string,
	payload: unknown,
	sender: EffectSender,
) {
	if (kind === SearchOrgEffects.indexMessages.name) {
		if (sender.kind !== "channel") return Option.some(`${kind} must come from a channel`)
		const channel = yield* localChannel(sender.id)
		return Option.isSome(channel)
			? Option.none<string>()
			: Option.some(`Channel ${sender.id} is not this org's`)
	}
	if (kind === SearchOrgEffects.indexConnectMessages.name) {
		if (sender.kind !== "org") return Option.some(`${kind} must come from the host org`)
		const { conversationId, channelId } = payload as IndexConnectMessagesPayload
		const db = yield* Database.Database
		const conversation = yield* db.first(
			SQLite.from(schema.connectConversationsTable)
				.select("hostOrganizationId")
				.where(($) => [$.id.eq(conversationId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(conversation) || conversation.value.hostOrganizationId !== sender.id) {
			return Option.some(`Conversation ${conversationId} is not hosted by org ${sender.id}`)
		}
		const mount = yield* db.first(
			SQLite.from(schema.connectConversationChannelsTable)
				.select("id")
				.where(($) => [
					$.channelId.eq(channelId),
					$.conversationId.eq(conversationId),
					$.role.eq("guest"),
				])
				.limit(1),
		)
		const channel = yield* localChannel(channelId)
		return Option.isSome(mount) && Option.isSome(channel)
			? Option.none<string>()
			: Option.some(`Channel ${channelId} is not this org's mount of ${conversationId}`)
	}
	return Option.none<string>()
})

/**
 * Rebuild the index from every channel this org owns (a guest mount is filled by its host):
 * idempotent, a later run supersedes an earlier one's progress. Joins the caller's transaction.
 */
export const reindexMessageSearch = Effect.fn("OrgObject.reindexMessageSearch")(function* () {
	if (!(yield* searchAvailable)) return 0
	const db = yield* Database.Database
	const generation = yield* Clock.currentTimeMillis
	const channels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const mounts = yield* db.run(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("channelId")
			.where(($) => [$.role.eq("guest"), $.isActive.eq(true), $.deletedAt.isNull()]),
	)
	const guestMounts = new Set<string>(mounts.map((row) => row.channelId))
	const owned = channels.filter((channel) => !guestMounts.has(channel.id))
	yield* db.run(SQLite.deleteFrom(schema.messageSearchBackfillTable).allRows())
	for (const channel of owned) {
		yield* db.run(
			SQLite.insertInto(schema.messageSearchBackfillTable).values({
				channelId: channel.id,
				generation,
			}),
		)
		yield* enqueueEffect(
			SearchChannelEffects.exportSearchMessages,
			channelTarget(channel.id) as { kind: "channel"; id: string },
			{ generation, after: null },
			{ id: `search-export:${channel.id}:${generation}` },
		)
	}
	yield* writeObjectMeta(VERSION_KEY, SEARCH_INDEX_VERSION)
	yield* Effect.annotateCurrentSpan({ "search.backfill_channels": owned.length })
	return owned.length
})

/**
 * On activation: a fresh object (its first migration ran just now) starts at the current
 * version; an older one starts a backfill. The outbox rows go out with the activating request's
 * flush (or the alarm). Needs the object's id to deliver, so it waits for one.
 */
export const prepareMessageSearch = Effect.fn("OrgObject.prepareMessageSearch")(function* (options: {
	readonly fresh: boolean
	readonly objectId: string | undefined
}) {
	if (!(yield* searchAvailable)) return
	const version = yield* readObjectMeta(VERSION_KEY)
	if (Option.getOrUndefined(version) === SEARCH_INDEX_VERSION) return
	if (options.fresh) return yield* writeObjectMeta(VERSION_KEY, SEARCH_INDEX_VERSION)
	if (options.objectId === undefined) return
	const db = yield* Database.Database
	yield* db.transaction(reindexMessageSearch())
})

/**
 * A backfill older than this counts as finished: a channel whose pages stopped coming (a dead
 * delivery, an object that never answers) must not keep search "indexing" forever.
 */
export const BACKFILL_TIMEOUT_MS = 6 * 60 * 60 * 1000

/** Whether some live channel still owes the current backfill pages. */
const backfillPending = Effect.gen(function* () {
	const db = yield* Database.Database
	const cutoff = (yield* Clock.currentTimeMillis) - BACKFILL_TIMEOUT_MS
	const pending = yield* db.first(
		SQLite.from(schema.messageSearchBackfillTable, "b")
			.innerJoin(schema.channelsTable, "c", (b, c) =>
				SQLite.and(c.id.eq(b.channelId), c.deletedAt.isNull()),
			)
			.select(($) => ({ channelId: $.channelId }))
			.where(($) => [$.done.eq(false), $.generation.gt(cutoff)])
			.limit(1),
	)
	return Option.isSome(pending)
})

// QUERY

/** The FTS5 query for the user's words: each a quoted prefix term, all required. */
export const toFtsQuery = (query: string) =>
	(query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).map((word) => `"${word}"*`).join(" ")

/** Snippet text without its markers, and where they were. */
export const parseSnippet = (raw: string) => {
	let snippet = ""
	let start = -1
	const highlights: Array<{ start: number; end: number }> = []
	for (const char of raw) {
		if (char === MARK_START) start = snippet.length
		else if (char === MARK_END) {
			if (start >= 0 && snippet.length > start) highlights.push({ start, end: snippet.length })
			start = -1
		} else snippet += char
	}
	return { snippet, highlights }
}

const encodeCursor = (createdAt: number, messageId: string) => `${createdAt}:${messageId}`

const decodeCursor = (cursor: string | undefined) => {
	if (cursor === undefined) return undefined
	const separator = cursor.indexOf(":")
	const createdAt = Number(cursor.slice(0, separator))
	const id = cursor.slice(separator + 1)
	return separator > 0 && Number.isFinite(createdAt) && id.length > 0 ? { createdAt, id } : undefined
}

/** `message.search`, run in the org's own object. */
export const searchMessages = Effect.fn("OrgObject.searchMessages")(
	function* (payload: MessageSearchPayload) {
		const user = yield* CurrentUser.Context
		const object = yield* currentObject
		if (
			Option.isNone(object) ||
			object.value.kind !== "org" ||
			object.value.id !== payload.organizationId
		) {
			return yield* new UnauthorizedError({
				message: "Search runs in the organization's object",
				detail: `Routed to ${Option.match(object, { onNone: () => "directory", onSome: (o) => o.kind })}`,
			})
		}
		if (!(yield* searchAvailable)) {
			yield* Effect.annotateCurrentSpan({ "search.unavailable": true })
			return new MessageSearchResponse({
				results: [],
				nextCursor: null,
				indexing: false,
				unavailable: true,
			})
		}
		const db = yield* Database.Database
		const limit = payload.limit ?? DEFAULT_LIMIT
		const fts = toFtsQuery(payload.query)
		const cursor = decodeCursor(payload.cursor)
		const hasFilter =
			payload.channelId !== undefined ||
			payload.authorId !== undefined ||
			payload.before !== undefined ||
			payload.after !== undefined
		yield* Effect.annotateCurrentSpan({
			"search.terms": fts.length === 0 ? 0 : fts.split(" ").length,
			"search.filtered": hasFilter,
			"search.limit": limit,
		})

		const indexing = yield* backfillPending
		// Nothing to match by: no words (only punctuation) and no filter.
		if (fts.length === 0 && (payload.query.trim().length > 0 || !hasFilter)) {
			return new MessageSearchResponse({ results: [], nextCursor: null, indexing })
		}

		// The caller's channels, the payload's filters, and the page after the cursor.
		const visible = <P>(s: {
			readonly channelId: SQLite.Expr<ChannelId, P>
			readonly authorId: SQLite.Expr<UserId, P>
			readonly createdAt: SQLite.Expr<number, P>
			readonly messageId: SQLite.Expr<MessageId, P>
		}) => [
			SQLite.inSubquery(
				s.channelId,
				SQLite.from(schema.channelAccessTable)
					.select("channelId")
					.where(($) => [$.userId.eq(user.id)]),
			),
			SQLite.when(payload.channelId, (channelId) => s.channelId.eq(channelId)),
			SQLite.when(payload.authorId, (authorId) => s.authorId.eq(authorId)),
			SQLite.when(payload.before, (before) => s.createdAt.lt(before.getTime())),
			SQLite.when(payload.after, (after) => s.createdAt.gt(after.getTime())),
			SQLite.when(cursor, ({ createdAt, id }) =>
				s.createdAt
					.lt(createdAt)
					.or(s.createdAt.eq(createdAt).and(s.messageId.lt(MessageId.make(id)))),
			),
		]
		const rows =
			fts.length > 0
				? yield* db.run(
						SQLite.from(schema.messageSearchFtsTable)
							.innerJoin(schema.messageSearchTable, "s", (f, s) => s.id.eq(f.rowid))
							.select(($) => ({
								messageId: $.s.messageId,
								channelId: $.s.channelId,
								authorId: $.s.authorId,
								createdAt: $.s.createdAt,
								snippet: SQLite.fts5.snippet(
									$,
									"content",
									MARK_START,
									MARK_END,
									"…",
									SNIPPET_TOKENS,
								),
							}))
							.where(($) => [SQLite.fts5.match($, fts), ...visible($.s)])
							.orderBy(($) => [
								[$.s.createdAt, "desc"],
								[$.s.messageId, "desc"],
							])
							.limit(limit + 1),
					)
				: yield* db.run(
						SQLite.from(schema.messageSearchTable, "s")
							.select(($) => ({
								messageId: $.messageId,
								channelId: $.channelId,
								authorId: $.authorId,
								createdAt: $.createdAt,
								snippet: SQLite.substr($.content, 1, PREVIEW_CHARS),
							}))
							.where(visible)
							.orderBy(($) => [
								[$.createdAt, "desc"],
								[$.messageId, "desc"],
							])
							.limit(limit + 1),
					)

		const page = rows.slice(0, limit)
		const results = page.map((row): MessageSearchHit => {
			const { snippet, highlights } = parseSnippet(row.snippet)
			return {
				messageId: row.messageId,
				channelId: row.channelId,
				authorId: row.authorId,
				createdAt: new Date(row.createdAt),
				snippet,
				highlights,
			}
		})
		const last = page.at(-1)
		yield* Effect.annotateCurrentSpan({ "search.results": results.length, "search.indexing": indexing })
		return new MessageSearchResponse({
			results,
			nextCursor:
				rows.length > limit && last !== undefined
					? encodeCursor(last.createdAt, last.messageId)
					: null,
			indexing,
		})
	},
	Effect.catchTag("DatabaseError", (error) =>
		Effect.fail(
			new InternalServerError({
				message: "Message search failed",
				detail: error.message,
				cause: error,
			}),
		),
	),
)
