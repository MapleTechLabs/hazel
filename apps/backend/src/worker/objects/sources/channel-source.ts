/**
 * What a `ChannelObject` streams: the channel's rows to its viewers. `channel_viewers` (the
 * channel's computed access, projected by the `OrgObject`) decides who may connect; a change to
 * it resnapshots (and so reauthorizes) the viewers it names, closing sockets whose access went.
 *
 * Messages are paged: a snapshot sends the newest {@link MESSAGE_SNAPSHOT_LIMIT} messages (plus
 * older pinned ones, so the pins list is whole) and only their reactions, pins, attachments and
 * chat-sync links; `LoadOlder` pages further back. Deltas go out for any row by key.
 */
import type { SyncPageCursor } from "@hazel/domain/sync"
import { Database, SQLite, schema } from "@hazel/db"
import type { SyncPage, SyncPaging, SyncRow, SyncSource } from "@hazel/sync-do"
import { Effect } from "effect"
import type { SyncPrincipal } from "../principal"
import { type ColumnAccessors, selectVisible, type SyncTableSpec, syncTable, userIdsOf } from "./rows"

/** Messages in a snapshot. */
export const MESSAGE_SNAPSHOT_LIMIT = 200
/** The most messages one `LoadOlder` returns. */
export const MESSAGE_PAGE_MAX = 200
/** Ids per `IN (…)`: DO SQLite binds at most 100 parameters per statement. */
const ID_BATCH = 50

const isViewer = (userId: string) =>
	SQLite.sql.cond`EXISTS (SELECT 1 FROM "channel_viewers" v WHERE v."userId" = ${userId})`

const toViewers = (table: SyncTableSpec<SyncPrincipal>["table"], softDelete: boolean) =>
	({
		table,
		visible: (p, $) => [softDelete ? $.deletedAt!.isNull() : undefined, isViewer(p.userId)],
		dependsOn: ["channel_viewers"],
		affectedPrincipals: userIdsOf,
	}) satisfies SyncTableSpec<SyncPrincipal>

const messages = toViewers(schema.messagesTable, true)
const reactions = toViewers(schema.messageReactionsTable, false)
const pins = toViewers(schema.pinnedMessagesTable, false)
const attachments = toViewers(schema.attachmentsTable, true)
const messageLinks = toViewers(schema.chatSyncMessageLinksTable, true)

export const channelSyncTables: ReadonlyArray<SyncTableSpec<SyncPrincipal>> = [
	messages,
	reactions,
	pins,
	attachments,
	messageLinks,
	toViewers(schema.typingIndicatorsTable, false),
]

/** The tables a messages page carries, and the column naming the message. */
const dependents = [
	{ spec: reactions, column: "messageId" },
	{ spec: pins, column: "messageId" },
	{ spec: attachments, column: "messageId" },
	{ spec: messageLinks, column: "hazelMessageId" },
] as const

/** Strictly older than `cursor` in `(createdAt, id)` order. */
const olderThan = ($: ColumnAccessors, cursor: SyncPageCursor) => {
	const at = new Date(cursor.createdAt)
	return SQLite.or($.createdAt!.lt(at), SQLite.and($.createdAt!.eq(at), $.id!.lt(cursor.id)))
}

const isPinned = ($: ColumnAccessors) =>
	SQLite.sql.cond`${$.id} IN (SELECT p."messageId" FROM "pinned_messages" p)`

const cursorOf = (row: SyncRow): SyncPageCursor => {
	const wire = row.row as { readonly createdAt: string; readonly id: string }
	return { createdAt: wire.createdAt, id: wire.id }
}

const chunk = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
	const chunks: Array<ReadonlyArray<A>> = []
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
	return chunks
}

/** Up to `limit` visible messages older than `before` (newest first) and their dependents. */
export const pageMessages = (principal: SyncPrincipal, before: SyncPageCursor | null, limit: number) =>
	Effect.gen(function* () {
		const newest = yield* selectVisible(
			messages,
			principal,
			($) => (before === null ? undefined : olderThan($, before)),
			{
				orderBy: ($) => [
					[$.createdAt!, "desc"],
					[$.id!, "desc"],
				],
				limit: limit + 1,
			},
		)
		const hasMore = newest.length > limit
		const window = newest.slice(0, limit)
		const last = window.at(-1)
		const oldest = last === undefined ? before : cursorOf(last)
		// The snapshot also carries pinned messages past the window: the pins list joins on them.
		const pinnedOlder =
			before === null && hasMore && oldest !== null
				? yield* selectVisible(messages, principal, ($) =>
						SQLite.and(isPinned($), olderThan($, oldest)),
					)
				: []
		const sent = [...window, ...pinnedOlder]
		const ids = sent.map((row) => row.key)
		const rows = new Map<string, ReadonlyArray<SyncRow>>([[messages.table.name, sent]])
		for (const { spec, column } of dependents) {
			const batches = yield* Effect.forEach(chunk(ids, ID_BATCH), (batch) =>
				selectVisible(spec, principal, ($) => $[column]!.in_(...batch)),
			)
			rows.set(spec.table.name, batches.flat())
		}
		// Uploads not attached to a message yet belong to no page: the snapshot sends them.
		if (before === null) {
			const pending = yield* selectVisible(attachments, principal, ($) => $.messageId!.isNull())
			rows.set(attachments.table.name, [...rows.get(attachments.table.name)!, ...pending])
		}
		yield* Effect.annotateCurrentSpan({
			"sync.messages": window.length,
			"sync.pinnedOlder": pinnedOlder.length,
			"sync.hasMore": hasMore,
		})
		return { rows, oldest, hasMore } satisfies SyncPage
	}).pipe(Effect.withSpan("ChannelSource.pageMessages", { attributes: { "sync.limit": limit } }))

const messagePaging: SyncPaging<SyncPrincipal, never, Database.Database> = {
	snapshotLimit: MESSAGE_SNAPSHOT_LIMIT,
	maxLimit: MESSAGE_PAGE_MAX,
	dependents: dependents.map(({ spec }) => spec.table.name),
	page: pageMessages,
}

/** A viewer of the channel; `not_found` before the `OrgObject` delivered any viewers. */
export const authorizeChannelViewer = (principal: SyncPrincipal) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const viewers = yield* db.run(
			SQLite.from(schema.channelViewersTable)
				.select("userId")
				.where(($) => [$.userId.eq(principal.userId)])
				.limit(1),
		)
		if (viewers.length > 0) return true as const
		const any = yield* db.first(SQLite.from(schema.channelViewersTable).select("userId").limit(1))
		return any._tag === "None" ? ("not_found" as const) : false
	}).pipe(Effect.orDie)

export const makeChannelSource = (): SyncSource<SyncPrincipal, never, Database.Database> => ({
	tables: channelSyncTables.map((spec) =>
		spec === messages ? { ...syncTable(spec), paging: messagePaging } : syncTable(spec),
	),
	dependencies: [{ name: "channel_viewers", key: ["userId"] }],
	authorize: authorizeChannelViewer,
	principalId: (principal) => principal.userId,
	expiresAt: (principal) => principal.expiresAt,
})
