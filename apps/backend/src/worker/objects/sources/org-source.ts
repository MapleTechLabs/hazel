/**
 * What an `OrgObject` streams, and to whom: the org's tables with the visibility Electric had
 * (`apps/electric-proxy/src/tables/user-tables.ts`), over the org's local `channel_access` and
 * `organization_members`.
 *
 * A principal is a member of the org or a Connect guest (an active `connect_participants` row).
 * A guest sees only the conversation rows of the channels it participates in (conversations,
 * mounts, participants) and the users it shares those channels with; the rest needs membership.
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

/** `userId` is an active member of this org (not a Connect guest). */
const isMember = (userId: string) =>
	SQLite.sql.cond`EXISTS (SELECT 1 FROM "organization_members" om
		WHERE om."userId" = ${userId} AND om."deletedAt" IS NULL)`

/** `col` is a user sharing one of `userId`'s channels (a guest's view of the host's users). */
const sharesChannel = (userId: string, col: SQLite.Expr<any>) =>
	SQLite.sql.cond`${col} IN (SELECT other."userId" FROM "channel_access" other WHERE other."channelId" IN
		(SELECT ca."channelId" FROM "channel_access" ca WHERE ca."userId" = ${userId}))`

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

/** Rows of the member's channels; never a guest's (`isMember`). */
const byChannel = (table: Spec["table"], channelColumn: string, softDelete = true): Spec => ({
	table,
	visible: (p, $) => [
		softDelete ? $.deletedAt!.isNull() : undefined,
		isMember(p.userId),
		channelAccess(p.userId, $[channelColumn]!),
	],
	dependsOn: [...CHANNELS, ...MEMBERSHIP],
	affectedPrincipals: affected,
})

/** Rows of a Connect conversation mounted in one of the principal's channels (members and guests). */
const byConversation = (table: Spec["table"], conversationColumn: string): Spec => ({
	table,
	visible: (p, $) => [$.deletedAt!.isNull(), conversationAccess(p.userId, $[conversationColumn]!)],
	dependsOn: ["channel_access", "connect_conversation_channels"],
	affectedPrincipals: affected,
})

/** Every row to members; to a guest, the users it shares a channel with. */
const toMembersAndPeers = (table: Spec["table"], userColumn: string, softDelete: boolean): Spec => ({
	table,
	visible: (p, $) => [
		softDelete ? $.deletedAt!.isNull() : undefined,
		SQLite.or(isMember(p.userId), sharesChannel(p.userId, $[userColumn]!)),
	],
	dependsOn: [...CHANNELS, ...MEMBERSHIP],
	affectedPrincipals: affected,
})

/** Every row to members (the installed bots). */
const toMembers = (table: Spec["table"], softDelete: boolean): Spec => ({
	table,
	visible: (p, $) => [softDelete ? $.deletedAt!.isNull() : undefined, isMember(p.userId)],
	dependsOn: MEMBERSHIP,
	affectedPrincipals: affected,
})

export const orgSyncTables: ReadonlyArray<Spec> = [
	byMembership(schema.organizationsTable, "id"),
	byMembership(schema.organizationMembersTable, "organizationId"),
	// Projections: users and presence of members and participants, the installed bots.
	toMembersAndPeers(schema.usersTable, "id", true),
	toMembersAndPeers(schema.userPresenceStatusTable, "userId", false),
	toMembers(schema.botsTable, true),
	toMembers(schema.botCommandsTable, false),
	byChannel(schema.channelsTable, "id"),
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
	byConversation(schema.connectConversationsTable, "id"),
	// Every mount of the conversation (the host's copies of the guests', a guest's of the host's).
	byConversation(schema.connectConversationChannelsTable, "conversationId"),
	byConversation(schema.connectParticipantsTable, "conversationId"),
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
