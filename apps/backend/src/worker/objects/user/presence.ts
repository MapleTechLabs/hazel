/**
 * Presence inside the `UserObject`, which owns the inputs (the status the user picked in
 * `user_presence_settings`, one `presence_sessions` row per connected client) and the result (the
 * `user_presence_status` row other people see, `./presence-model.ts`).
 *
 * Every event changes an input, then `reconcile` recomputes the row:
 *
 * - A sync socket opens: a session starts. Its pings (every 25 s) keep it alive; its `Presence`
 *   frames say what client it is, whether it is idle, and which channel it shows.
 * - The socket closes: its session ends at once. A socket whose client vanished stops pinging and
 *   its session ends on the alarm after `SESSION_TIMEOUT_MS`.
 * - The user picks a status (`setPreferredStatus`), maybe for a while; the alarm ends it.
 * - The alarm also clears a custom status past its `statusExpiresAt`.
 *
 * A change others can see goes to each of the user's orgs (`user_organizations`) through the outbox
 * (`org.upsertPresenceProjection`), in the same transaction. While a session is live the row is
 * re-projected every `PRESENCE_RENEW_MS`, and each org expires a copy nobody renewed
 * (`../org/projections.ts`), so a copy is right even when this object never runs again.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { SyncPresence } from "@hazel/domain/sync"
import { ChannelId, type OrganizationId, UserId } from "@hazel/schema"
import { type SyncObjectState, type SyncSocket, socketSessionId } from "@hazel/sync-do"
import { Clock, Effect, Match, Option, Schema } from "effect"
import { OrgEffects } from "../effects/org-effects"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import type { PresenceProjection } from "../org/projections"
import { aggregate, isLive, type PreferredStatus, sessionDeadline } from "./presence-model"
import { HEARTBEAT_SESSION_ID, PRESENCE_RENEW_MS } from "./presence-timing"

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
	desktopStatus: row.desktopStatus,
	webStatus: row.webStatus,
	mobileStatus: row.mobileStatus,
	afk: row.afk,
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

export const findPreference = (userId: UserId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.userPresenceSettingsTable)
				.select()
				.where(($) => [$.userId.eq(userId)])
				.limit(1),
		),
	)

/** The fields of a user nobody has seen yet: offline, no custom status. */
export const defaultPresence = (now: Date): PresenceFields => ({
	status: "offline",
	customMessage: null,
	statusEmoji: null,
	statusExpiresAt: null,
	activeChannelId: null,
	suppressNotifications: false,
	updatedAt: now,
	lastSeenAt: now,
	desktopStatus: null,
	webStatus: null,
	mobileStatus: null,
	afk: true,
})

const sameTime = (a: Date | null, b: Date | null) => (a === null ? b === null : a.getTime() === b?.getTime())

/** Whether the orgs must hear of `next`: anything they show differs from `previous`. */
const differsForOthers = (previous: PresenceFields, next: PresenceFields) =>
	previous.status !== next.status ||
	previous.desktopStatus !== next.desktopStatus ||
	previous.webStatus !== next.webStatus ||
	previous.mobileStatus !== next.mobileStatus ||
	previous.afk !== next.afk ||
	previous.activeChannelId !== next.activeChannelId ||
	previous.customMessage !== next.customMessage ||
	previous.statusEmoji !== next.statusEmoji ||
	!sameTime(previous.statusExpiresAt, next.statusExpiresAt) ||
	previous.suppressNotifications !== next.suppressNotifications

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

const writePreference = (userId: UserId, status: PreferredStatus, statusExpiresAt: Date | null, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.userPresenceSettingsTable)
				.values({ userId, status, statusExpiresAt, updatedAt: now })
				.onConflictDoUpdate({ target: ["userId"], set: { status, statusExpiresAt, updatedAt: now } }),
		),
	)

type SessionPatch = Partial<
	Pick<schema.PresenceSession, "clientType" | "idle" | "afk" | "focusedChannelId" | "legacy">
>

/** Start or touch session `id`: `lastBeatAt` moves to now, with `patch` applied. */
const touchSession = (id: string, patch: SessionPatch = {}) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		yield* db.run(
			SQLite.insertInto(schema.presenceSessionsTable)
				.values({ id, ...patch, connectedAt: now, lastBeatAt: now })
				.onConflictDoUpdate({ target: ["id"], set: { ...patch, lastBeatAt: now } }),
		)
	})

const deleteSessions = (ids: ReadonlyArray<string>) =>
	ids.length === 0
		? Effect.void
		: Effect.flatMap(Database.Database, (db) =>
				db.run(SQLite.deleteFrom(schema.presenceSessionsTable).where(($) => [$.id.in_(...ids)])),
			)

// RECONCILE

/** How far `lastSeenAt` must move before a ping writes it (well inside `SESSION_TIMEOUT_MS`). */
const LAST_SEEN_STEP_MS = 30_000

export interface ReconcileOptions {
	/** The sessions whose sockets are open (the alarm knows); others end. Unknown: trust the pings. */
	readonly openSessionIds?: ReadonlySet<string>
	/** Fields the caller sets on the row itself (custom status, "pause notifications"). */
	readonly patch?: PresencePatch
}

/** The row's own fields an RPC sets: the custom status and "pause notifications". */
export interface PresencePatch {
	customMessage?: string | null
	statusEmoji?: string | null
	statusExpiresAt?: Date | null
	suppressNotifications?: boolean
}

/**
 * Recompute the user's row from the pick and the live sessions, ending what expired (a timed pick,
 * a custom status, sessions past their timeout). Writes the row when it moved, and projects it when
 * others would see a change or the orgs' lease is due. Inside a transaction.
 */
export const reconcile = Effect.fn("UserObject.reconcilePresence")(function* (
	userId: UserId,
	options: ReconcileOptions = {},
) {
	const db = yield* Database.Database
	const nowMs = yield* Clock.currentTimeMillis
	const now = new Date(nowMs)

	let preference = Option.getOrUndefined(yield* findPreference(userId))
	if (
		preference !== undefined &&
		preference.statusExpiresAt !== null &&
		preference.statusExpiresAt.getTime() <= nowMs
	) {
		yield* writePreference(userId, "online", null, now)
		preference = { ...preference, status: "online", statusExpiresAt: null, updatedAt: now }
	}

	const sessions = yield* db.run(SQLite.from(schema.presenceSessionsTable).select())
	const live = sessions.filter((session) => isLive(session, nowMs, options.openSessionIds))
	yield* deleteSessions(sessions.filter((session) => !live.includes(session)).map((session) => session.id))

	const existing = Option.getOrUndefined(yield* findPresence(userId))
	const previous: PresenceFields =
		existing === undefined
			? defaultPresence(now)
			: (({ id: _id, userId: _userId, ...fields }) => fields)(existing)
	const withPatch = { ...previous, ...options.patch }
	const isCustomExpired = withPatch.statusExpiresAt !== null && withPatch.statusExpiresAt.getTime() <= nowMs
	const lastBeatMs = Math.max(...live.map((session) => session.lastBeatAt.getTime()))
	const next: PresenceFields = {
		...withPatch,
		...aggregate(preference, live, nowMs),
		customMessage: isCustomExpired ? null : withPatch.customMessage,
		statusEmoji: isCustomExpired ? null : withPatch.statusEmoji,
		statusExpiresAt: isCustomExpired ? null : withPatch.statusExpiresAt,
		lastSeenAt: live.length > 0 ? new Date(lastBeatMs) : previous.lastSeenAt,
	}

	const isChanged = existing === undefined || differsForOthers(previous, next)
	const isRenewDue = live.length > 0 && previous.updatedAt.getTime() + PRESENCE_RENEW_MS <= nowMs
	yield* Effect.annotateCurrentSpan({
		"presence.from": existing?.status ?? "none",
		"presence.to": next.status,
		"presence.sessions": live.length,
		"presence.ended": sessions.length - live.length,
		"presence.preferred": preference?.status ?? "none",
		"presence.projected": isChanged || isRenewDue,
	})
	if (isChanged || isRenewDue) {
		const row = yield* writePresence(userId, { ...next, updatedAt: now })
		yield* projectPresence(row)
		return { row, projected: true }
	}
	// The row is synced to the user's own clients: a ping moves `lastSeenAt` only every so often.
	const lastSeenMovedMs = next.lastSeenAt.getTime() - previous.lastSeenAt.getTime()
	if (existing !== undefined && lastSeenMovedMs < LAST_SEEN_STEP_MS) {
		return { row: existing, projected: false }
	}
	return { row: yield* writePresence(userId, next), projected: false }
})

// EVENTS (each inside the caller's transaction)

const toChannelId = Schema.decodeUnknownOption(ChannelId)

/** A sync socket opened: its session starts. */
export const sessionOpened = (userId: UserId, sessionId: string) =>
	Effect.andThen(touchSession(sessionId), reconcile(userId))

/** A ping on the session's socket: it is still there. */
export const sessionBeat = (userId: UserId, sessionId: string) =>
	Effect.andThen(touchSession(sessionId), reconcile(userId))

/** The session's client said what it is, whether it is idle, and what it shows. */
export const sessionPresence = (userId: UserId, sessionId: string, frame: SyncPresence) =>
	Effect.andThen(
		touchSession(sessionId, {
			clientType: frame.clientType,
			idle: frame.idle,
			afk: frame.afk,
			focusedChannelId: Option.getOrNull(toChannelId(frame.focusedChannelId)),
			legacy: false,
		}),
		reconcile(userId),
	)

/** The session's socket closed: it ends now. */
export const sessionClosed = (userId: UserId, sessionId: string) =>
	Effect.andThen(deleteSessions([sessionId]), reconcile(userId))

/** The user picked a status, on every device; `expiresAt` ends it (null: until changed). */
export const setPreferredStatus = Effect.fn("UserObject.setPreferredStatus")(function* (
	userId: UserId,
	status: PreferredStatus,
	expiresAt: Date | null,
) {
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* writePreference(userId, status, expiresAt, now)
	return yield* reconcile(userId)
})

/** Patch every session an older client opened (they send no frames; their RPCs speak for them). */
const patchLegacySessions = (patch: SessionPatch) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.update(schema.presenceSessionsTable)
				.set(patch)
				.where(($) => [$.legacy.eq(true)]),
		),
	)

/** `userPresenceStatus.heartbeat` from an older client: keeps its own session alive. */
export const legacyHeartbeat = (userId: UserId) =>
	Effect.andThen(touchSession(HEARTBEAT_SESSION_ID), reconcile(userId))

/**
 * `userPresenceStatus.update`'s `status` and `activeChannelId` from an older client, mapped onto
 * the new inputs: its AFK `away` makes its sessions idle and AFK (so pushes go out at once),
 * `online` makes them active again and picks Online, `busy`/`dnd` picks Do Not Disturb. An older
 * client cannot pick Invisible, so none of its picks undo that.
 */
export const applyLegacyUpdate = Effect.fn("UserObject.applyLegacyUpdate")(function* (
	userId: UserId,
	payload: {
		readonly status?: schema.UserPresenceStatus["status"] | undefined
		readonly activeChannelId?: ChannelId | null | undefined
	},
) {
	const now = new Date(yield* Clock.currentTimeMillis)
	if (payload.activeChannelId !== undefined) {
		yield* patchLegacySessions({ focusedChannelId: payload.activeChannelId })
	}
	const pickUnlessInvisible = (status: PreferredStatus) =>
		Effect.gen(function* () {
			const current = Option.getOrUndefined(yield* findPreference(userId))
			if (current?.status !== "invisible") yield* writePreference(userId, status, null, now)
		})
	yield* Match.value(payload.status).pipe(
		Match.when("away", () => patchLegacySessions({ idle: true, afk: true })),
		Match.whenOr("busy", "dnd", () => pickUnlessInvisible("dnd")),
		Match.when("online", () =>
			Effect.andThen(patchLegacySessions({ idle: false, afk: false }), pickUnlessInvisible("online")),
		),
		Match.whenOr("offline", Match.undefined, () => Effect.void),
		Match.exhaustive,
	)
})

/** The sendBeacon from an older client's unload: its sessions end now. */
export const markOffline = (userId: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		yield* db.run(SQLite.deleteFrom(schema.presenceSessionsTable).where(($) => [$.legacy.eq(true)]))
		return (yield* reconcile(userId)).projected
	})

/** When the alarm must next run: a timed pick or custom status ending, a session timing out. */
export const presenceDeadlines = (userId: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const preference = Option.getOrUndefined(yield* findPreference(userId))
		const row = Option.getOrUndefined(yield* findPresence(userId))
		const sessions = yield* db.run(SQLite.from(schema.presenceSessionsTable).select("lastBeatAt"))
		return [
			preference?.statusExpiresAt?.getTime(),
			row?.statusExpiresAt?.getTime(),
			...sessions.map(sessionDeadline),
		]
	})

// HOOKS

const PresenceOrPing = Schema.Union([
	Schema.TaggedStruct("Ping", {}),
	Schema.TaggedStruct("Presence", {
		clientType: Schema.Literals(["desktop", "web", "mobile"]),
		idle: Schema.Boolean,
		afk: Schema.Boolean,
		focusedChannelId: Schema.NullOr(Schema.String),
	}),
])
const decodePresenceOrPing = Schema.decodeUnknownOption(Schema.fromJsonString(PresenceOrPing))

/** Hooks the `UserObject`'s runtime calls (`../runtime.ts`): sockets, frames, deadlines, the alarm. */
export const makePresenceHooks = (state: SyncObjectState, ownerId: () => string | undefined) => {
	const owner = () => Option.flatMap(Option.fromNullishOr(ownerId()), Schema.decodeUnknownOption(UserId))

	/** The sessions whose sockets are open, plus the RPC heartbeat's (it has no socket). */
	const openSessionIds = () =>
		new Set([
			HEARTBEAT_SESSION_ID,
			...state
				.getWebSockets()
				.filter((socket) => socket.readyState === undefined || socket.readyState === 1)
				.flatMap((socket) => Option.toArray(Option.fromNullishOr(socketSessionId(socket)))),
		])

	/** Run `f` for the owner in one transaction; returns whether the orgs were told. Best effort. */
	const forOwner = <E, R>(
		name: string,
		f: (userId: UserId) => Effect.Effect<{ readonly projected: boolean }, E, R>,
	) =>
		Effect.gen(function* () {
			const userId = owner()
			if (Option.isNone(userId)) return false
			const db = yield* Database.Database
			return (yield* db.transaction(f(userId.value))).projected
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning(`Presence ${name} failed`, cause).pipe(Effect.as(false)),
			),
			Effect.withSpan(`UserObject.presence.${name}`),
		)

	const forSession = <E, R>(
		name: string,
		socket: SyncSocket,
		f: (userId: UserId, sessionId: string) => Effect.Effect<{ readonly projected: boolean }, E, R>,
	) => {
		const sessionId = socketSessionId(socket)
		if (sessionId !== undefined) return forOwner(name, (userId) => f(userId, sessionId))
		// Adopted before sockets carried a session (`SyncAttachment.session`): it can't count toward
		// presence, so it is closed with "service restart" and the client reconnects into one.
		if (name !== "closed") socket.close(1012, "presence_session_required")
		return Effect.succeed(false)
	}

	return {
		/** A sync socket was accepted for `userId`; returns whether the object should flush. */
		opened: (userId: string, socket: SyncSocket) =>
			userId === ownerId() ? forSession("opened", socket, sessionOpened) : Effect.succeed(false),
		/** A frame arrived on `socket`: a ping keeps its session alive, `Presence` updates it. */
		message: (socket: SyncSocket, message: string | ArrayBuffer) => {
			// The sync runtime reads binary frames as UTF-8 text too.
			const text = typeof message === "string" ? message : new TextDecoder().decode(message)
			const frame = decodePresenceOrPing(text)
			if (Option.isNone(frame)) return Effect.succeed(false)
			const value = frame.value
			return value._tag === "Ping"
				? forSession("beat", socket, sessionBeat)
				: forSession("frame", socket, (userId, sessionId) =>
						sessionPresence(userId, sessionId, value),
					)
		},
		/** `socket` closed: its session ends. */
		closed: (socket: SyncSocket) => forSession("closed", socket, sessionClosed),
		alarm: forOwner("alarm", (userId) => reconcile(userId, { openSessionIds: openSessionIds() })),
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
