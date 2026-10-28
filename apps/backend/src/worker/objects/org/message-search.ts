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
import { SqlClient } from "effect/sql/SqlClient"
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
	const sql = yield* SqlClient
	const rows = yield* sql`SELECT 1 AS present FROM sqlite_master
		WHERE type = 'table' AND name IN ('message_search', 'message_search_fts', 'message_search_backfill')`
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
	const sql = yield* SqlClient
	if (change.replace) yield* sql`DELETE FROM message_search WHERE "channelId" = ${channelId}`
	if (change.remove.length > 0) {
		yield* sql`DELETE FROM message_search
			WHERE "channelId" = ${channelId} AND ${sql.in("messageId", change.remove)}`
	}
	const names = yield* namesFor(change.upsert)
	for (const message of change.upsert) {
		const content = toSearchText(message.content, (id) => names.get(id))
		yield* sql`INSERT INTO message_search ("messageId", "channelId", "authorId", "conversationId", "createdAt", "content")
			VALUES (${message.id}, ${channelId}, ${message.authorId}, ${message.conversationId}, ${message.createdAt}, ${content})
			ON CONFLICT ("messageId") DO UPDATE SET
				"channelId" = excluded."channelId", "authorId" = excluded."authorId",
				"conversationId" = excluded."conversationId", "createdAt" = excluded."createdAt",
				"content" = excluded."content"`
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
		const sql = yield* SqlClient
		yield* sql`DELETE FROM message_search_backfill WHERE "channelId" = ${channelId}`
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
	const sql = yield* SqlClient
	const rows = yield* sql<{ generation: number }>`SELECT generation FROM message_search_backfill
		WHERE "channelId" = ${channelId}`
	// A page of an earlier backfill: its rows still count, its chain does not continue.
	if (rows[0] === undefined || Number(rows[0].generation) !== page.generation) return
	if (page.next === null) {
		yield* sql`UPDATE message_search_backfill SET done = 1 WHERE "channelId" = ${channelId}`
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
	const sql = yield* SqlClient
	yield* sql`DELETE FROM message_search WHERE "channelId" = ${channelId}`
}, Effect.mapError(Database.toDatabaseError))

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
	const sql = yield* SqlClient
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
	yield* sql`DELETE FROM message_search_backfill`
	for (const channel of owned) {
		yield* sql`INSERT INTO message_search_backfill ("channelId", generation, done)
			VALUES (${channel.id}, ${generation}, 0)`
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
	const sql = yield* SqlClient
	const cutoff = (yield* Clock.currentTimeMillis) - BACKFILL_TIMEOUT_MS
	const rows = yield* sql`SELECT 1 AS pending FROM message_search_backfill b
		JOIN channels c ON c."id" = b."channelId" AND c."deletedAt" IS NULL
		WHERE b.done = 0 AND b.generation > ${cutoff} LIMIT 1`
	return rows.length > 0
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

interface HitRow {
	readonly messageId: string
	readonly channelId: string
	readonly authorId: string
	readonly createdAt: number
	readonly snippet: string
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
		const sql = yield* SqlClient
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

		const conditions = [
			sql`s."channelId" IN (SELECT "channelId" FROM channel_access WHERE "userId" = ${user.id})`,
			...(payload.channelId === undefined ? [] : [sql`s."channelId" = ${payload.channelId}`]),
			...(payload.authorId === undefined ? [] : [sql`s."authorId" = ${payload.authorId}`]),
			...(payload.before === undefined ? [] : [sql`s."createdAt" < ${payload.before.getTime()}`]),
			...(payload.after === undefined ? [] : [sql`s."createdAt" > ${payload.after.getTime()}`]),
			...(cursor === undefined
				? []
				: [
						sql`(s."createdAt" < ${cursor.createdAt} OR (s."createdAt" = ${cursor.createdAt} AND s."messageId" < ${cursor.id}))`,
					]),
		]
		const where = sql.and(conditions)
		const rows =
			fts.length > 0
				? yield* sql<HitRow>`SELECT s."messageId", s."channelId", s."authorId", s."createdAt",
					snippet(message_search_fts, 0, char(2), char(3), '…', ${SNIPPET_TOKENS}) AS snippet
				FROM message_search_fts JOIN message_search s ON s."id" = message_search_fts.rowid
				WHERE message_search_fts MATCH ${fts} AND ${where}
				ORDER BY s."createdAt" DESC, s."messageId" DESC LIMIT ${limit + 1}`
				: yield* sql<HitRow>`SELECT s."messageId", s."channelId", s."authorId", s."createdAt",
					substr(s."content", 1, ${PREVIEW_CHARS}) AS snippet
				FROM message_search s WHERE ${where}
				ORDER BY s."createdAt" DESC, s."messageId" DESC LIMIT ${limit + 1}`

		const page = rows.slice(0, limit)
		const results = page.map((row): MessageSearchHit => {
			const { snippet, highlights } = parseSnippet(row.snippet)
			return {
				messageId: MessageId.make(row.messageId),
				channelId: ChannelId.make(row.channelId),
				authorId: UserId.make(row.authorId),
				createdAt: new Date(Number(row.createdAt)),
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
					? encodeCursor(Number(last.createdAt), last.messageId)
					: null,
			indexing,
		})
	},
	Effect.catchTag("SqlError", (error) =>
		Effect.fail(
			new InternalServerError({
				message: "Message search failed",
				detail: error.message,
				cause: error,
			}),
		),
	),
)
