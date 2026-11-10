/**
 * What a `CustomersObject` streams (`docs/customers/tech-design.md` §2): the live lists of the
 * Customers area, to the org's members (`customer_members`, projected by the `OrgObject`).
 *
 * Heavy or per-account data (contacts, refs, billing, daily series, events, unmatched records)
 * is not streamed: the read RPCs serve it. Closed signals stream for 30 days (the Done tab);
 * older ones page through `customers.signals.history`.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { SyncSource } from "@hazel/sync-do"
import type { UserId } from "@hazel/schema"
import { Effect } from "effect"
import type { SyncPrincipal } from "../principal"
import { type SyncTableSpec, syncTable, userIdsOf } from "./rows"

/** Closed signals stay in the stream this long. */
export const CLOSED_SIGNAL_WINDOW_DAYS = 30

const isMember = (userId: UserId) =>
	SQLite.sql.cond`EXISTS (SELECT 1 FROM "customer_members" cm WHERE cm."userId" = ${userId})`

export const customersSyncTables: ReadonlyArray<SyncTableSpec<SyncPrincipal>> = [
	{ table: schema.customerAccountsTable, visible: (p, $) => [$.deletedAt.isNull(), isMember(p.userId)] },
	{
		table: schema.customerSignalsTable,
		visible: (p, $) => [
			isMember(p.userId),
			SQLite.sql
				.cond`(${$.closedAt} IS NULL OR ${$.closedAt} > strftime('%Y-%m-%d %H:%M:%f', 'now', ${`-${CLOSED_SIGNAL_WINDOW_DAYS} days`}))`,
		],
	},
	{
		table: schema.customerSignalRulesTable,
		visible: (p, $) => [$.deletedAt.isNull(), isMember(p.userId)],
	},
	{ table: schema.customerNotesTable, visible: (p, $) => [$.deletedAt.isNull(), isMember(p.userId)] },
	{
		table: schema.customerSavedViewsTable,
		visible: (p, $) => [
			$.deletedAt.isNull(),
			isMember(p.userId),
			SQLite.sql.cond`(${$.ownerUserId} IS NULL OR ${$.ownerUserId} = ${p.userId})`,
		],
	},
	{ table: schema.customerSettingsTable, visible: (p) => [isMember(p.userId)] },
	{ table: schema.customerMetricDefinitionsTable, visible: (p) => [isMember(p.userId)] },
	{ table: schema.customerConnectionsTable, visible: (p) => [isMember(p.userId)] },
	{
		table: schema.customerSyncRunsTable,
		visible: (p, $) => [
			isMember(p.userId),
			SQLite.sql.cond`${$.startedAt} > strftime('%Y-%m-%d %H:%M:%f', 'now', '-7 days')`,
		],
	},
]

/** A member of the org (`customer_members`); `not_found` before the first members projection. */
const authorize = (principal: SyncPrincipal) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const member = yield* db.first(
			SQLite.from(schema.customerMembersTable)
				.select("userId")
				.where(($) => [$.userId.eq(principal.userId)])
				.limit(1),
		)
		if (member._tag === "Some") return true as const
		const any = yield* db.first(SQLite.from(schema.customerMembersTable).select("userId").limit(1))
		return any._tag === "None" ? ("not_found" as const) : false
	}).pipe(Effect.orDie)

/** A `customer_members` change re-snapshots (or refuses) the sockets of the users it names. */
export const makeCustomersSource = (): SyncSource<SyncPrincipal, never, Database.Database> => ({
	tables: customersSyncTables.map((spec) =>
		syncTable({ ...spec, dependsOn: ["customer_members"], affectedPrincipals: userIdsOf }),
	),
	dependencies: [{ name: "customer_members", key: ["userId"] }],
	authorize,
	principalId: (principal) => principal.userId,
	expiresAt: (principal) => principal.expiresAt,
})
