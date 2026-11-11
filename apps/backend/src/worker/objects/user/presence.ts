/**
 * Presence inside the `UserObject`, which owns the user's `user_presence_status` row, as one state
 * machine (`transition`): events in, the next row out, and whether the orgs must hear of it.
 *
 * - `Active` (a heartbeat, a sync socket opening): online if they were offline; otherwise only
 *   `lastSeenAt` moves, except once per `PRESENCE_RENEW_MS` the row is re-projected so each org's
 *   copy keeps a fresh lease.
 * - `Disconnected` (the last socket closing, the sendBeacon): offline at once.
 * - `Tick` (the object's alarm): a custom status past its `statusExpiresAt` is cleared, and a user
 *   with no heartbeat for `HEARTBEAT_TIMEOUT_MS` goes offline, open socket or not (a socket whose
 *   client vanished can stay "open" here long after).
 *
 * Every projected change goes to each of the user's orgs (`user_organizations`) through the outbox
 * (`org.upsertPresenceProjection`), in the same transaction. Each org also expires its own copy
 * once its lease runs out (`../org/projections.ts`), so the copy is right even when this object
 * never runs again.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type OrganizationId, UserId } from "@hazel/schema"
import type { SyncObjectState, SyncSocket } from "@hazel/sync-do"
import { Clock, Effect, Option, Schema } from "effect"
import { OrgEffects } from "../effects/org-effects"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import type { PresenceProjection } from "../org/projections"
import { HEARTBEAT_TIMEOUT_MS, PRESENCE_RENEW_MS } from "./presence-timing"

export { HEARTBEAT_TIMEOUT_MS } from "./presence-timing"

export type PresenceRow = schema.UserPresenceStatus
export type PresenceFields = Omit<PresenceRow, "id" | "userId">

const toProjection = (row: PresenceRow): PresenceProjection => ({
	id: row.id,
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

// STATE MACHINE

export type PresenceEvent = "Active" | "Disconnected" | "Tick"

/** A transition's outcome: the next fields, and whether the orgs must get them. */
export interface PresenceStep {
	readonly fields: PresenceFields
	readonly project: boolean
}

const isStale = (fields: PresenceFields, nowMs: number) =>
	fields.lastSeenAt.getTime() + HEARTBEAT_TIMEOUT_MS <= nowMs

/**
 * The presence state machine. `current` is the stored row (undefined: never seen); returns the
 * next row, or undefined when the event changes nothing. Pure, so every path is tested directly.
 *
 * `updatedAt` moves only when the orgs are told, so it is also when the orgs' lease was renewed.
 */
export const transition = (
	current: PresenceFields | undefined,
	event: PresenceEvent,
	nowMs: number,
): PresenceStep | undefined => {
	const now = new Date(nowMs)
	switch (event) {
		case "Active": {
			if (current === undefined) return { fields: defaultPresence(now), project: true }
			if (current.status === "offline") {
				return {
					fields: { ...current, status: "online", updatedAt: now, lastSeenAt: now },
					project: true,
				}
			}
			const renew = current.updatedAt.getTime() + PRESENCE_RENEW_MS <= nowMs
			const fields = { ...current, lastSeenAt: now }
			if (renew) fields.updatedAt = now
			return { fields, project: renew }
		}
		case "Disconnected": {
			if (current === undefined || current.status === "offline") return undefined
			return { fields: { ...current, status: "offline", updatedAt: now }, project: true }
		}
		case "Tick": {
			if (current === undefined) return undefined
			const isStatusExpired =
				current.statusExpiresAt !== null && current.statusExpiresAt.getTime() <= nowMs
			const goesOffline = current.status !== "offline" && isStale(current, nowMs)
			if (!isStatusExpired && !goesOffline) return undefined
			const fields = { ...current, updatedAt: now }
			if (isStatusExpired) {
				fields.statusEmoji = null
				fields.customMessage = null
				fields.statusExpiresAt = null
			}
			if (goesOffline) fields.status = "offline"
			return { fields, project: true }
		}
	}
}

/** When the alarm must next run: status expiry, and heartbeat staleness while not offline. */
export const presenceDeadlinesOf = (fields: PresenceFields): ReadonlyArray<number | undefined> => [
	fields.statusExpiresAt?.getTime(),
	fields.status !== "offline" ? fields.lastSeenAt.getTime() + HEARTBEAT_TIMEOUT_MS : undefined,
]

// STORAGE

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

const writePresence = (userId: UserId, fields: PresenceFields) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.userPresenceStatusTable)
				.values({ userId, ...fields })
				.onConflictDoUpdate({ target: ["userId"], set: fields })
				.returning(),
		),
	).pipe(Effect.map((rows) => rows[0]!))

/** Write the user's presence and project it. Inside a transaction (the outbox joins it). */
export const savePresence = Effect.fn("UserObject.savePresence")(function* (
	userId: UserId,
	fields: PresenceFields,
) {
	const row = yield* writePresence(userId, fields)
	yield* projectPresence(row)
	return row
})

/**
 * Run `event` through the state machine for `userId` and store the outcome (projecting it when
 * the step says so). Inside a transaction. Returns the row and whether the orgs were told.
 */
export const applyPresenceEvent = Effect.fn("UserObject.applyPresenceEvent")(function* (
	userId: UserId,
	event: PresenceEvent,
) {
	const nowMs = yield* Clock.currentTimeMillis
	const existing = Option.getOrUndefined(yield* findPresence(userId))
	const current =
		existing === undefined ? undefined : (({ id: _id, userId: _u, ...fields }) => fields)(existing)
	const step = transition(current, event, nowMs)
	yield* Effect.annotateCurrentSpan({
		"presence.event": event,
		"presence.from": existing?.status ?? "none",
		"presence.to": step?.fields.status ?? existing?.status ?? "none",
		"presence.projected": step?.project ?? false,
	})
	if (step === undefined) return { row: existing, projected: false }
	const row = step.project
		? yield* savePresence(userId, step.fields)
		: yield* writePresence(userId, step.fields)
	return { row, projected: step.project }
})

/** The user is active (a heartbeat, a socket opening). Returns the row. */
export const markActive = (userId: UserId) =>
	applyPresenceEvent(userId, "Active").pipe(Effect.map(({ row }) => row!))

/** Offline, unless they already are; returns whether that changed anything. */
export const markOffline = (userId: UserId) =>
	applyPresenceEvent(userId, "Disconnected").pipe(Effect.map(({ projected }) => projected))

/** The alarm's work (custom status expiry, heartbeat staleness); returns whether anything changed. */
export const expirePresence = (userId: UserId) =>
	applyPresenceEvent(userId, "Tick").pipe(Effect.map(({ projected }) => projected))

/** When the alarm must next run for presence. */
export const presenceDeadlines = (userId: UserId) =>
	findPresence(userId).pipe(Effect.map(Option.match({ onNone: () => [], onSome: presenceDeadlinesOf })))

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
		alarm: forOwner("alarm", expirePresence).pipe(Effect.map(Option.getOrElse(() => false))),
		deadlines: Effect.suspend(() =>
			Option.match(owner(), {
				onNone: () => Effect.succeed([]),
				onSome: presenceDeadlines,
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
