/**
 * What an `OrgObject` streams, and to whom: the org's tables with the visibility Electric had
 * (`apps/electric-proxy/src/tables/user-tables.ts`), over the org's local `channel_access` and
 * `organization_members`.
 *
 * A principal is a member of the org or a Connect guest (an active `connect_participants` row).
 * A guest's `channel_access` holds only the conversation channels it participates in, so the
 * channel-scoped tables show it those rows only; the member-scoped ones show it nothing.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { Change, SyncSource } from "@hazel/sync-do"
import { Effect } from "effect"
import type { SyncPrincipal } from "../principal"
import { type SyncTableSpec, syncTable, userIdsOf } from "./rows"

/** `col` is an organization `userId` is an active member of. */
const memberOf = (userId: string, col: SQLite.Expr<any>) =>
	SQLite.sql.cond`${col} IN (SELECT om."organizationId" FROM "organization_members" om
		WHERE om."userId" = ${userId} AND om."deletedAt" IS NULL)`

/** `col` is a channel in `userId`'s `channel_access`. */
const channelAccess = (userId: string, col: SQLite.Expr<any>) =>
	SQLite.sql.cond`${col} IN (SELECT ca."channelId" FROM "channel_access" ca WHERE ca."userId" = ${userId})`

/** `col` is a Connect conversation mounted in one of `userId`'s channels. */
const conversationAccess = (userId: string, col: SQLite.Expr<any>) =>
	SQLite.sql.cond`${col} IN (SELECT ccc."conversationId" FROM "connect_conversation_channels" ccc
		WHERE ccc."deletedAt" IS NULL AND ccc."channelId" IN
			(SELECT ca."channelId" FROM "channel_access" ca WHERE ca."userId" = ${userId}))`

/**
 * Who a dependency change affects: a `channel_access` row names its user; a membership or
 * participant row is keyed by its own id, so those resnapshot everyone (rare writes).
 */
const affected = (changes: ReadonlyArray<Change>): ReadonlyArray<string> | "all" =>
	changes.some((change) => change.tbl !== "channel_access") ? "all" : userIdsOf(changes)

const MEMBERSHIP = ["organization_members", "connect_participants"] as const
const CHANNELS = ["channel_access"] as const

type Spec = SyncTableSpec<SyncPrincipal>

const byMembership = (table: Spec["table"], orgColumn: string, softDelete = true): Spec => ({
	table,
	visible: (p, $) => [softDelete ? $.deletedAt!.isNull() : undefined, memberOf(p.userId, $[orgColumn]!)],
	dependsOn: MEMBERSHIP,
	affectedPrincipals: affected,
})

const byChannel = (table: Spec["table"], channelColumn: string, softDelete = true): Spec => ({
	table,
	visible: (p, $) => [
		softDelete ? $.deletedAt!.isNull() : undefined,
		channelAccess(p.userId, $[channelColumn]!),
	],
	dependsOn: CHANNELS,
	affectedPrincipals: affected,
})

/** Visible to every principal the org admits (members and guests), as Electric had it. */
const toEveryone = (table: Spec["table"], softDelete: boolean): Spec => ({
	table,
	visible: (_p, $) => [softDelete ? $.deletedAt!.isNull() : undefined],
	dependsOn: MEMBERSHIP,
	affectedPrincipals: affected,
})

export const orgSyncTables: ReadonlyArray<Spec> = [
	byMembership(schema.organizationsTable, "id"),
	byMembership(schema.organizationMembersTable, "organizationId"),
	// Projections: users and presence of members and participants, the installed bots.
	toEveryone(schema.usersTable, true),
	toEveryone(schema.userPresenceStatusTable, false),
	toEveryone(schema.botsTable, true),
	toEveryone(schema.botCommandsTable, false),
	{
		table: schema.channelsTable,
		visible: (p, $) => [$.deletedAt!.isNull(), channelAccess(p.userId, $.id!)],
		dependsOn: CHANNELS,
		affectedPrincipals: affected,
	},
	byChannel(schema.channelMembersTable, "channelId"),
	byMembership(schema.channelSectionsTable, "organizationId"),
	byMembership(schema.customEmojisTable, "organizationId"),
	byMembership(schema.botInstallationsTable, "organizationId", false),
	{
		// Org-level connections in the user's orgs, or the user's own.
		table: schema.integrationConnectionsTable,
		visible: (p, $) => [
			$.deletedAt!.isNull(),
			SQLite.or(
				SQLite.and($.userId!.isNull(), memberOf(p.userId, $.organizationId!)),
				$.userId!.eq(p.userId),
			),
		],
		dependsOn: MEMBERSHIP,
		affectedPrincipals: affected,
	},
	byMembership(schema.chatSyncConnectionsTable, "organizationId"),
	byChannel(schema.chatSyncChannelLinksTable, "hazelChannelId"),
	{
		table: schema.connectConversationsTable,
		visible: (p, $) => [$.deletedAt!.isNull(), conversationAccess(p.userId, $.id!)],
		dependsOn: ["channel_access", "connect_conversation_channels"],
		affectedPrincipals: affected,
	},
	byChannel(schema.connectConversationChannelsTable, "channelId"),
	byChannel(schema.connectParticipantsTable, "channelId"),
]

/** Member of the org or a Connect guest; `not_found` before the org exists here. */
const authorize = (principal: SyncPrincipal) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const member = yield* db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [$.userId.eq(principal.userId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (member._tag === "Some") return true as const
		const guest = yield* db.first(
			SQLite.from(schema.connectParticipantsTable)
				.select("id")
				.where(($) => [$.userId.eq(principal.userId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (guest._tag === "Some") return true as const
		const org = yield* db.first(
			SQLite.from(schema.organizationsTable)
				.select("id")
				.where(($) => [$.deletedAt.isNull()])
				.limit(1),
		)
		return org._tag === "None" ? ("not_found" as const) : false
	}).pipe(Effect.orDie)

export const makeOrgSource = (): SyncSource<SyncPrincipal, never, Database.Database> => ({
	tables: orgSyncTables.map(syncTable),
	dependencies: [{ name: "channel_access", key: ["userId", "channelId"] }],
	authorize,
	principalId: (principal) => principal.userId,
	expiresAt: (principal) => principal.expiresAt,
})
