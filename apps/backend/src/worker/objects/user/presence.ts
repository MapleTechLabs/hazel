/**
 * Presence inside the `UserObject`, which owns the user's `user_presence_status` row. Every status
 * change is projected to each of the user's orgs (`user_organizations`) through the outbox
 * (`org.upsertPresenceProjection`), in the same transaction.
 *
 * Replaces the cluster's crons:
 *
 * - online while the user has an open sync socket on their `UserObject`: the first socket marks
 *   them online, the last one closing marks them offline;
 * - without a socket, the heartbeat RPC keeps them online and the alarm marks them offline
 *   `HEARTBEAT_TIMEOUT_MS` after the last one (`PresenceCleanup`);
 * - the alarm clears a custom status at its `statusExpiresAt` (`StatusExpiration`).
 *
 * Heartbeats only touch `lastSeenAt` locally; orgs get it with the next status change.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type OrganizationId, UserId } from "@hazel/schema"
import type { SyncObjectState, SyncSocket } from "@hazel/sync-do"
import { Clock, Effect, Option, Schema } from "effect"
import { OrgEffects } from "../effects/org-effects"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import type { PresenceProjection } from "../org/projections"

/** 3x the client's 15 s heartbeat. */
export const HEARTBEAT_TIMEOUT_MS = 45_000

export type PresenceRow = schema.UserPresenceStatus
export type PresenceFields = Omit<PresenceRow, "id" | "userId">

const toProjection = (row: PresenceRow): PresenceProjection => ({
	userId: row.userId,
	status: row.status,
	customMessage: row.customMessage,
	statusEmoji: row.statusEmoji,
	statusExpiresAt: row.statusExpiresAt === null ? null : row.statusExpiresAt.toISOString(),
	activeChannelId: row.activeChannelId,
	suppressNotifications: row.suppressNotifications,
	updatedAt: row.updatedAt.toISOString(),
	lastSeenAt: row.lastSeenAt.toISOString(),
})

export const findPresence = (userId: UserId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.userPresenceStatusTable)
				.select()
				.where(($) => [$.userId.eq(userId)])
				.limit(1),
		),
	)

/** The fields of a user nobody has seen yet. */
export const defaultPresence = (now: Date): PresenceFields => ({
	status: "online",
	customMessage: null,
	statusEmoji: null,
	statusExpiresAt: null,
	activeChannelId: null,
	suppressNotifications: false,
	updatedAt: now,
	lastSeenAt: now,
})

/** Project `row` to each of the user's orgs (outbox; inside the caller's transaction). */
const projectPresence = Effect.fn("UserObject.projectPresence")(function* (row: PresenceRow) {
	const db = yield* Database.Database
	const organizations = yield* db.run(SQLite.from(schema.userOrganizationsTable).select("organizationId"))
	const projection = toProjection(row)
	yield* Effect.forEach(
		organizations,
		({ organizationId }) =>
			enqueueEffect(OrgEffects.upsertPresenceProjection, orgTarget(organizationId), projection),
		{ discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "presence.orgs": organizations.length })
})

/** Project the user's current presence (if any) to one org they just joined. */
export const projectPresenceTo = Effect.fn("UserObject.projectPresenceTo")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const row = yield* db.first(SQLite.from(schema.userPresenceStatusTable).select().limit(1))
	if (Option.isNone(row)) return
	yield* enqueueEffect(
		OrgEffects.upsertPresenceProjection,
		orgTarget(organizationId),
		toProjection(row.value),
	)
})

/** Write the user's presence and project it. Inside a transaction (the outbox joins it). */
export const savePresence = Effect.fn("UserObject.savePresence")(function* (
	userId: UserId,
	fields: PresenceFields,
) {
	const db = yield* Database.Database
	const [row] = yield* db.run(
		SQLite.insertInto(schema.userPresenceStatusTable)
			.values({ userId, ...fields })
			.onConflictDoUpdate({ target: ["userId"], set: fields })
			.returning(),
	)
	yield* projectPresence(row!)
	return row!
})

const touch = (userId: UserId, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.update(schema.userPresenceStatusTable)
				.set({ lastSeenAt: now })
				.where(($) => [$.userId.eq(userId)])
				.returning(),
		),
	)

/**
 * The user is active (a heartbeat, a socket opening): online again if they were offline, else
 * only `lastSeenAt`. Returns the row.
 */
export const markActive = Effect.fn("UserObject.markActive")(function* (userId: UserId) {
	const now = new Date(yield* Clock.currentTimeMillis)
	const existing = yield* findPresence(userId)
	if (Option.isNone(existing)) return yield* savePresence(userId, defaultPresence(now))
	if (existing.value.status === "offline") {
		const { id: _id, userId: _userId, ...fields } = existing.value
		return yield* savePresence(userId, { ...fields, status: "online", updatedAt: now, lastSeenAt: now })
	}
	return Option.getOrElse(yield* touch(userId, now), () => existing.value)
})

/** Offline, unless they already are. */
export const markOffline = Effect.fn("UserObject.markOffline")(function* (userId: UserId) {
	const existing = yield* findPresence(userId)
	if (Option.isNone(existing) || existing.value.status === "offline") return false
	const now = new Date(yield* Clock.currentTimeMillis)
	const { id: _id, userId: _userId, ...fields } = existing.value
	yield* savePresence(userId, { ...fields, status: "offline", updatedAt: now })
	return true
})

/**
 * The alarm's work: clear an expired custom status, and mark a socketless user offline once their
 * heartbeat is stale. Returns whether anything changed. Inside a transaction.
 */
export const expirePresence = Effect.fn("UserObject.expirePresence")(function* (
	userId: UserId,
	openSockets: number,
) {
	const existing = yield* findPresence(userId)
	if (Option.isNone(existing)) return false
	const nowMs = yield* Clock.currentTimeMillis
	const { id: _id, userId: _userId, ...fields } = existing.value
	const next = { ...fields }
	let changed = false
	if (fields.statusExpiresAt !== null && fields.statusExpiresAt.getTime() <= nowMs) {
		next.statusEmoji = null
		next.customMessage = null
		next.statusExpiresAt = null
		changed = true
	}
	if (
		openSockets === 0 &&
		fields.status !== "offline" &&
		fields.lastSeenAt.getTime() + HEARTBEAT_TIMEOUT_MS <= nowMs
	) {
		next.status = "offline"
		changed = true
	}
	if (!changed) return false
	yield* savePresence(userId, { ...next, updatedAt: new Date(nowMs) })
	yield* Effect.annotateCurrentSpan({ "presence.status": next.status })
	return true
})

/** When the alarm must next run for presence: status expiry, and heartbeat staleness without a socket. */
export const presenceDeadlines = (userId: UserId, openSockets: number) =>
	findPresence(userId).pipe(
		Effect.map(
			Option.match({
				onNone: () => [],
				onSome: (row) => [
					row.statusExpiresAt?.getTime(),
					openSockets === 0 && row.status !== "offline"
						? row.lastSeenAt.getTime() + HEARTBEAT_TIMEOUT_MS
						: undefined,
				],
			}),
		),
	)

/** Hooks the `UserObject`'s runtime calls (`../runtime.ts`): sockets, deadlines and the alarm. */
export const makePresenceHooks = (state: SyncObjectState, ownerId: () => string | undefined) => {
	/** Open sync sockets, not counting `closing`. */
	const openSockets = (closing?: SyncSocket) =>
		state
			.getWebSockets()
			.filter(
				(socket) =>
					socket !== closing && (socket.readyState === undefined || socket.readyState === 1),
			).length

	const owner = () => Option.flatMap(Option.fromNullishOr(ownerId()), Schema.decodeUnknownOption(UserId))

	/** Run `f` for the owner in one transaction; failures are logged (presence is best effort). */
	const forOwner = <A, E, R>(name: string, f: (userId: UserId) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const userId = owner()
			if (Option.isNone(userId)) return Option.none<A>()
			const db = yield* Database.Database
			return Option.some(yield* db.transaction(f(userId.value)))
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning(`Presence ${name} failed`, cause).pipe(Effect.as(Option.none<A>())),
			),
			Effect.withSpan(`UserObject.presence.${name}`),
		)

	return {
		/** A sync socket was accepted for `userId`; returns whether the object should flush. */
		opened: (userId: string) =>
			userId === ownerId()
				? forOwner("opened", markActive).pipe(Effect.map(Option.isSome))
				: Effect.succeed(false),
		/** `socket` closed: offline once it was the last one. */
		closed: (socket: SyncSocket) =>
			openSockets(socket) > 0
				? Effect.succeed(false)
				: forOwner("closed", markOffline).pipe(Effect.map(Option.getOrElse(() => false))),
		alarm: forOwner("alarm", (userId) => expirePresence(userId, openSockets())).pipe(
			Effect.map(Option.getOrElse(() => false)),
		),
		deadlines: Effect.suspend(() =>
			Option.match(owner(), {
				onNone: () => Effect.succeed([]),
				onSome: (userId) => presenceDeadlines(userId, openSockets()),
			}),
		).pipe(
			Effect.catchTag("DatabaseError", (error) =>
				Effect.logWarning("Presence deadline lookup failed", { error: error.message }).pipe(
					Effect.as([]),
				),
			),
		),
	}
}
