/**
 * The `OrgObject`'s read-only copies of other stores' rows (`infra/durable-object-sync-plan.md`
 * §1): `users` (members, Connect participants, webhook and integration bots) from the directory,
 * `user_presence_status` from each user's `UserObject`. Written only here: by the receivers of
 * `org.upsertUserProjection` / `org.upsertPresenceProjection` / `org.removeUserProjection`, and
 * by `projectUsers` when a user joins (it reads the directory row itself).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, UserId, UserPresenceStatusId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Directory } from "../../../services/directory"

/** ISO timestamp text. */
const Timestamp = Schema.String

/** A `users` row as it crosses the outbox (timestamps as ISO text). */
export const UserProjection = Schema.Struct({
	id: UserId,
	externalId: Schema.String,
	email: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.Literals(["user", "machine"]),
	settings: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	isOnboarded: Schema.Boolean,
	timezone: Schema.NullOr(Schema.String),
	createdAt: Timestamp,
	updatedAt: Timestamp,
	deletedAt: Schema.NullOr(Timestamp),
})
export type UserProjection = typeof UserProjection.Type

/** A `user_presence_status` row as it crosses the outbox. */
export const PresenceProjection = Schema.Struct({
	/** The UserObject row's id, so the client sees one presence row per user from every source. */
	id: UserPresenceStatusId,
	userId: UserId,
	status: Schema.Literals(["online", "away", "busy", "dnd", "offline"]),
	customMessage: Schema.NullOr(Schema.String),
	statusEmoji: Schema.NullOr(Schema.String),
	statusExpiresAt: Schema.NullOr(Timestamp),
	activeChannelId: Schema.NullOr(ChannelId),
	suppressNotifications: Schema.Boolean,
	updatedAt: Timestamp,
	lastSeenAt: Timestamp,
})
export type PresenceProjection = typeof PresenceProjection.Type

export const RemoveUserProjectionPayload = Schema.Struct({ userId: UserId })

const toDate = (value: string | null) => (value === null ? null : new Date(value))

/** A directory `users` row in the projection's wire form. */
export const toUserProjection = (row: schema.User): UserProjection => ({
	id: row.id,
	externalId: row.externalId,
	email: row.email,
	firstName: row.firstName,
	lastName: row.lastName,
	avatarUrl: row.avatarUrl,
	userType: row.userType,
	settings: row.settings,
	isOnboarded: row.isOnboarded,
	timezone: row.timezone,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
})

export const upsertUserProjection = Effect.fn("OrgObject.upsertUserProjection")(function* (
	user: UserProjection,
) {
	const db = yield* Database.Database
	const row = {
		...user,
		createdAt: new Date(user.createdAt),
		updatedAt: new Date(user.updatedAt),
		deletedAt: toDate(user.deletedAt),
	}
	const { id: _id, ...set } = row
	yield* db.run(
		SQLite.insertInto(schema.usersTable)
			.values(row)
			.onConflictDoUpdate({ target: ["id"], set }),
	)
})

export const upsertPresenceProjection = Effect.fn("OrgObject.upsertPresenceProjection")(function* (
	presence: PresenceProjection,
) {
	const db = yield* Database.Database
	const row = {
		...presence,
		statusExpiresAt: toDate(presence.statusExpiresAt),
		updatedAt: new Date(presence.updatedAt),
		lastSeenAt: new Date(presence.lastSeenAt),
	}
	const { userId: _userId, ...set } = row
	yield* db.run(
		SQLite.insertInto(schema.userPresenceStatusTable)
			.values(row)
			.onConflictDoUpdate({ target: ["userId"], set }),
	)
})

/** Is `userId` still someone this org shows (an active member or Connect participant)? */
const isKnown = (userId: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const member = yield* db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isSome(member)) return true
		const participant = yield* db.first(
			SQLite.from(schema.connectParticipantsTable)
				.select("id")
				.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()])
				.limit(1),
		)
		return Option.isSome(participant)
	})

export const removeUserProjection = Effect.fn("OrgObject.removeUserProjection")(function* (payload: {
	readonly userId: UserId
}) {
	if (yield* isKnown(payload.userId)) return
	const db = yield* Database.Database
	yield* db.run(SQLite.deleteFrom(schema.usersTable).where(($) => [$.id.eq(payload.userId)]))
	yield* db.run(
		SQLite.deleteFrom(schema.userPresenceStatusTable).where(($) => [$.userId.eq(payload.userId)]),
	)
})

/**
 * Copy `userIds`' directory rows into the org (a user joining, a DM partner). Reads D1 directly;
 * a user the directory does not know is skipped (the org may already hold its row).
 */
export const projectUsers = Effect.fn("OrgObject.projectUsers")(function* (userIds: ReadonlyArray<UserId>) {
	if (userIds.length === 0) return
	const directory = yield* Directory
	const rows = yield* directory.db.run(
		SQLite.from(schema.usersTable)
			.select()
			.where(($) => [$.id.in_(...new Set(userIds))]),
	)
	yield* Effect.forEach(rows, (row) => upsertUserProjection(toUserProjection(row)), { discard: true })
	yield* Effect.annotateCurrentSpan({ "org.projected_users": rows.length })
})
