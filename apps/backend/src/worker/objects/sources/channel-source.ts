/**
 * What a `ChannelObject` streams: every row of the channel to its viewers. `channel_viewers` (the
 * channel's computed access, projected by the `OrgObject`) decides who may connect; a change to
 * it resnapshots (and so reauthorizes) the viewers it names, closing sockets whose access went.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { SyncSource } from "@hazel/sync-do"
import { Effect } from "effect"
import type { SyncPrincipal } from "../principal"
import { type SyncTableSpec, syncTable, userIdsOf } from "./rows"

const isViewer = (userId: string) =>
	SQLite.sql.cond`EXISTS (SELECT 1 FROM "channel_viewers" v WHERE v."userId" = ${userId})`

const toViewers = (table: SyncTableSpec<SyncPrincipal>["table"], softDelete: boolean) =>
	({
		table,
		visible: (p, $) => [softDelete ? $.deletedAt!.isNull() : undefined, isViewer(p.userId)],
		dependsOn: ["channel_viewers"],
		affectedPrincipals: userIdsOf,
	}) satisfies SyncTableSpec<SyncPrincipal>

export const channelSyncTables: ReadonlyArray<SyncTableSpec<SyncPrincipal>> = [
	toViewers(schema.messagesTable, true),
	toViewers(schema.messageReactionsTable, false),
	toViewers(schema.pinnedMessagesTable, false),
	toViewers(schema.attachmentsTable, true),
	toViewers(schema.chatSyncMessageLinksTable, true),
	toViewers(schema.typingIndicatorsTable, false),
]

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
	tables: channelSyncTables.map(syncTable),
	dependencies: [{ name: "channel_viewers", key: ["userId"] }],
	authorize: authorizeChannelViewer,
	principalId: (principal) => principal.userId,
	expiresAt: (principal) => principal.expiresAt,
})
