/**
 * The directory (D1): global identities, bots, invitations and the routing indexes
 * (`infra/durable-object-sync-plan.md` §1). Used by the api Worker to route RPCs and by objects to
 * keep their index rows current.
 *
 * D1 has no transactions: every write here is one idempotent statement (an upsert keyed by the
 * row's primary key), so an outbox retry or a duplicate delivery is harmless. Never wrap these in
 * `db.transaction`.
 */
import type { D1Database } from "@cloudflare/workers-types"
import { Database, type DatabaseError, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, type Option } from "effect"

export type ChannelIndexRow = schema.ChannelIndex
export type OrgIndexRow = schema.OrgIndex
export type MembershipIndexRow = schema.MembershipIndex

export interface DirectoryShape {
	/** The directory database itself, for directory-path handlers. No transactions (D1). */
	readonly db: Database.DatabaseShape
	readonly channel: (channelId: ChannelId) => Effect.Effect<Option.Option<ChannelIndexRow>, DatabaseError>
	readonly upsertChannel: (row: {
		readonly channelId: ChannelId
		readonly organizationId: OrganizationId
		readonly hostChannelId: ChannelId | null
		readonly deletedAt: Date | null
	}) => Effect.Effect<void, DatabaseError>
	readonly org: (organizationId: OrganizationId) => Effect.Effect<Option.Option<OrgIndexRow>, DatabaseError>
	readonly upsertOrg: (row: {
		readonly id: OrganizationId
		readonly slug: string | null
		readonly name: string
		readonly deletedAt: Date | null
	}) => Effect.Effect<void, DatabaseError>
	readonly membership: (
		userId: UserId,
		organizationId: OrganizationId,
	) => Effect.Effect<Option.Option<MembershipIndexRow>, DatabaseError>
	/** The organizations `userId` is an active member of. */
	readonly organizationsOf: (userId: UserId) => Effect.Effect<ReadonlyArray<OrganizationId>, DatabaseError>
	readonly upsertMembership: (row: {
		readonly userId: UserId
		readonly organizationId: OrganizationId
		readonly deletedAt: Date | null
	}) => Effect.Effect<void, DatabaseError>
}

export const makeDirectory = (db: Database.DatabaseShape): DirectoryShape => ({
	db,
	channel: (channelId) =>
		db
			.first(
				SQLite.from(schema.channelIndexTable)
					.select()
					.where(($) => [$.channelId.eq(channelId)])
					.limit(1),
			)
			.pipe(Effect.withSpan("Directory.channel", { attributes: { "channel.id": channelId } })),
	upsertChannel: (row) =>
		db
			.run(
				SQLite.insertInto(schema.channelIndexTable)
					.values(row)
					.onConflictDoUpdate({
						target: ["channelId"],
						set: {
							organizationId: row.organizationId,
							hostChannelId: row.hostChannelId,
							deletedAt: row.deletedAt,
						},
					}),
			)
			.pipe(
				Effect.asVoid,
				Effect.withSpan("Directory.upsertChannel", { attributes: { "channel.id": row.channelId } }),
			),
	org: (organizationId) =>
		db
			.first(
				SQLite.from(schema.orgIndexTable)
					.select()
					.where(($) => [$.id.eq(organizationId)])
					.limit(1),
			)
			.pipe(Effect.withSpan("Directory.org")),
	upsertOrg: (row) =>
		db
			.run(
				SQLite.insertInto(schema.orgIndexTable)
					.values(row)
					.onConflictDoUpdate({
						target: ["id"],
						set: { slug: row.slug, name: row.name, deletedAt: row.deletedAt },
					}),
			)
			.pipe(Effect.asVoid, Effect.withSpan("Directory.upsertOrg")),
	membership: (userId, organizationId) =>
		db
			.first(
				SQLite.from(schema.membershipIndexTable)
					.select()
					.where(($) => [$.userId.eq(userId), $.organizationId.eq(organizationId)])
					.limit(1),
			)
			.pipe(Effect.withSpan("Directory.membership")),
	organizationsOf: (userId) =>
		db
			.run(
				SQLite.from(schema.membershipIndexTable)
					.select("organizationId")
					.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()]),
			)
			.pipe(
				Effect.map((rows) => rows.map((row) => row.organizationId)),
				Effect.withSpan("Directory.organizationsOf"),
			),
	upsertMembership: (row) =>
		db
			.run(
				SQLite.insertInto(schema.membershipIndexTable)
					.values(row)
					.onConflictDoUpdate({
						target: ["userId", "organizationId"],
						set: { deletedAt: row.deletedAt },
					}),
			)
			.pipe(Effect.asVoid, Effect.withSpan("Directory.upsertMembership")),
})

export class Directory extends Context.Service<Directory, DirectoryShape>()("@hazel/backend/Directory") {
	/** Over the Worker's (or an object's) `DIRECTORY_DB` binding. */
	static readonly layerD1 = (binding: D1Database): Layer.Layer<Directory> =>
		Layer.effect(this, Effect.map(Database.Database, makeDirectory)).pipe(
			Layer.provide(Database.layerD1(binding)),
		)

	/** Over the `Database` in context: node SQLite in tests, the Bun runtime's single database. */
	static readonly layerDatabase: Layer.Layer<Directory, never, Database.Database> = Layer.effect(
		this,
		Effect.map(Database.Database, makeDirectory),
	)
}
