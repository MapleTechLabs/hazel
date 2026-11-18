/**
 * Push notifications inside the `UserObject`: the owner's devices (`push_devices`), whether a new
 * notification is pushed (`decidePush`), and the `push.send` outbox effect that sends it to APNs
 * (`services/apns.ts`), one row per device.
 *
 * A push goes out only while the user is idle elsewhere: offline or away (or never seen) is
 * pushed at once; online or busy on some client is deferred `PUSH_IDLE_DELAY_MS`, an outbox row
 * the alarm delivers. Every send first checks that the notification still exists and is unread
 * (reading the channel deletes it, `user.clearChannelNotifications`), so a deferred push the
 * user already saw on another client is dropped. Silent notifications (do not disturb, quiet
 * hours) and `dnd` are never pushed.
 *
 * Each row has its own target (`push:<notificationId>.<n>`): a retrying device never holds back
 * another device or a later notification behind the outbox's per-target order.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, NotificationId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { ApnsClient, ApnsRetryableError, type ApnsResult } from "../../../services/apns"
import { Directory } from "../../../services/directory"
import { CurrentEffectSender, defineEffect, enqueueEffect, type EffectReceivers } from "../effects/registry"
import { tokenOwner } from "./push-ownership"
import { HEARTBEAT_TIMEOUT_MS } from "./presence-timing"

/** How long a notification waits while the user is active elsewhere. */
export const PUSH_IDLE_DELAY_MS = 60_000

/** How long APNs keeps trying an undelivered push. */
export const PUSH_EXPIRATION_MS = 24 * 60 * 60 * 1000

/** What a push says, and the app path it opens. */
export const PushContent = Schema.Struct({
	title: Schema.String,
	body: Schema.String,
	/** `/<orgSlug>/chat/<channelId>`; absent when the org has no slug. */
	path: Schema.optional(Schema.String),
})
export type PushContent = typeof PushContent.Type

export const PushSendPayload = Schema.Struct({
	notificationId: NotificationId,
	channelId: ChannelId,
	token: Schema.String,
	...PushContent.fields,
})
export type PushSendPayload = typeof PushSendPayload.Type

export const PushEffects = {
	send: defineEffect("push.send", "push", PushSendPayload),
}

// DECISION

export type PushDecision =
	| { readonly _tag: "Skip"; readonly reason: "disabled" | "no-content" | "silent" | "no-devices" | "dnd" }
	| { readonly _tag: "Now" }
	| { readonly _tag: "Defer"; readonly delayMs: number }

export interface PushInput {
	readonly enabled: boolean
	readonly hasContent: boolean
	readonly silent: boolean
	readonly devices: number
	/** The owner's presence row; undefined: never seen. */
	readonly presence:
		| { readonly status: schema.UserPresenceStatus["status"]; readonly lastSeenAt: Date }
		| undefined
	readonly nowMs: number
}

/** Whether a new notification is pushed, now or after `PUSH_IDLE_DELAY_MS`. Pure. */
export const decidePush = (input: PushInput): PushDecision => {
	if (!input.enabled) return { _tag: "Skip", reason: "disabled" }
	if (!input.hasContent) return { _tag: "Skip", reason: "no-content" }
	if (input.silent) return { _tag: "Skip", reason: "silent" }
	if (input.devices === 0) return { _tag: "Skip", reason: "no-devices" }
	const { presence } = input
	if (presence === undefined) return { _tag: "Now" }
	switch (presence.status) {
		case "dnd":
			return { _tag: "Skip", reason: "dnd" }
		case "offline":
		case "away":
			return { _tag: "Now" }
		case "online":
		case "busy":
			// No heartbeat for the timeout: gone, even if the alarm has not marked it offline yet.
			return presence.lastSeenAt.getTime() + HEARTBEAT_TIMEOUT_MS <= input.nowMs
				? { _tag: "Now" }
				: { _tag: "Defer", delayMs: PUSH_IDLE_DELAY_MS }
	}
}

/** What to do with APNs's answer. Pure. */
export type ApnsOutcome =
	| "Delivered"
	/** The token is dead: forget the device. */
	| "Unregistered"
	/** The provider token expired: the client signs a new one, retry. */
	| "ProviderToken"
	/** The provider token is wrong (key, key id or team): no retry fixes that. */
	| "Misconfigured"
	| "Retry"
	/** Any other refusal: log and drop (retrying would not help). */
	| "Rejected"

const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"])

export const apnsOutcome = ({ status, reason }: ApnsResult): ApnsOutcome => {
	if (status === 200) return "Delivered"
	if (status === 410) return "Unregistered"
	if (status === 400 && reason !== null && DEAD_TOKEN_REASONS.has(reason)) return "Unregistered"
	if (status === 403 && reason === "ExpiredProviderToken") return "ProviderToken"
	if (status === 403 && reason === "InvalidProviderToken") return "Misconfigured"
	if (status === 429 || status >= 500) return "Retry"
	return "Rejected"
}

// DEVICES

/** A user's devices past this many: the least recently registered go. */
export const MAX_PUSH_DEVICES = 10

/** Register (or refresh) a device; returns its `updatedAt`. */
export const registerDevice = Effect.fn("UserObject.registerDevice")(function* (device: {
	readonly token: string
	readonly environment: schema.PushDevice["environment"]
	readonly bundleId: string
}) {
	const db = yield* Database.Database
	const updatedAt = new Date(yield* Clock.currentTimeMillis)
	yield* db.run(
		SQLite.insertInto(schema.pushDevicesTable)
			.values({ ...device, updatedAt })
			.onConflictDoUpdate({
				target: ["token"],
				set: { environment: device.environment, bundleId: device.bundleId, updatedAt },
			}),
	)
	yield* db.query(
		Database.sql`DELETE FROM push_devices WHERE token NOT IN (SELECT token FROM push_devices ORDER BY updatedAt DESC LIMIT ${MAX_PUSH_DEVICES})`,
	)
	return updatedAt
})

/** Forget a device; with `registeredBy`, only if it was not registered again after that. */
export const unregisterDevice = (token: string, registeredBy?: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.deleteFrom(schema.pushDevicesTable).where(($) => [
				$.token.eq(token),
				...(registeredBy === undefined ? [] : [$.updatedAt.lte(registeredBy)]),
			]),
		),
	)

// SCHEDULING

/**
 * Decide on a new notification's push and enqueue one `push.send` per device (deferred while the
 * user is active elsewhere). Inside the notification's transaction.
 */
export const schedulePush = Effect.fn("UserObject.pushDecision")(function* (input: {
	readonly notificationId: NotificationId
	readonly channelId: ChannelId
	readonly silent: boolean
	readonly content: PushContent | undefined
}) {
	const apns = yield* ApnsClient
	const db = yield* Database.Database
	const devices = yield* db.run(SQLite.from(schema.pushDevicesTable).select("token"))
	// The store holds only its owner's presence row.
	const presence = yield* db.first(
		SQLite.from(schema.userPresenceStatusTable).select("status", "lastSeenAt").limit(1),
	)
	const decision = decidePush({
		enabled: apns.enabled,
		hasContent: input.content !== undefined,
		silent: input.silent,
		devices: devices.length,
		presence: Option.getOrUndefined(presence),
		nowMs: yield* Clock.currentTimeMillis,
	})
	yield* Effect.annotateCurrentSpan({
		"push.decision": decision._tag,
		"push.skip_reason": decision._tag === "Skip" ? decision.reason : "",
		"push.devices": devices.length,
		"push.presence": Option.match(presence, { onNone: () => "none", onSome: (row) => row.status }),
	})
	if (decision._tag === "Skip" || input.content === undefined) return decision
	const content = input.content
	yield* Effect.forEach(
		devices,
		(device, index) =>
			enqueueEffect(
				PushEffects.send,
				{ kind: "push", id: `${input.notificationId}.${index}` },
				{
					notificationId: input.notificationId,
					channelId: input.channelId,
					token: device.token,
					...content,
				},
				decision._tag === "Defer" ? { delayMs: decision.delayMs } : undefined,
			),
		{ discard: true },
	).pipe(Effect.withSpan("UserObject.enqueuePush", { attributes: { "push.devices": devices.length } }))
	return decision
})

// SENDING

/**
 * `push.send`: one device, if the notification is still unread, the user is not on do not
 * disturb now, and the token is still theirs. Runs in the sender's outbox: `CurrentEffectSender`
 * is this `UserObject`, with its stored id, so it names the owner.
 */
const sendPush = Effect.fn("UserObject.sendPush")(function* (payload: PushSendPayload) {
	const db = yield* Database.Database
	const apns = yield* ApnsClient
	const notification = yield* db.first(
		SQLite.from(schema.notificationsTable)
			.select("readAt", "createdAt")
			.where(($) => [$.id.eq(payload.notificationId)])
			.limit(1),
	)
	if (Option.isNone(notification) || notification.value.readAt !== null) {
		yield* Effect.annotateCurrentSpan({ "push.skipped": "read" })
		return
	}
	const nowMs = yield* Clock.currentTimeMillis
	// A send still retrying past APNs's own expiry would only show stale news.
	if (notification.value.createdAt.getTime() + PUSH_EXPIRATION_MS <= nowMs) {
		yield* Effect.annotateCurrentSpan({ "push.skipped": "expired" })
		return
	}
	// Deferred while they were online: do not disturb set since then holds it back.
	const presence = yield* db.first(SQLite.from(schema.userPresenceStatusTable).select("status").limit(1))
	if (Option.isSome(presence) && presence.value.status === "dnd") {
		yield* Effect.annotateCurrentSpan({ "push.skipped": "dnd" })
		return
	}
	const device = yield* db.first(
		SQLite.from(schema.pushDevicesTable)
			.select("environment", "bundleId", "updatedAt")
			.where(($) => [$.token.eq(payload.token)])
			.limit(1),
	)
	if (Option.isNone(device)) {
		yield* Effect.annotateCurrentSpan({ "push.skipped": "unregistered" })
		return
	}
	if (!apns.enabled) {
		yield* Effect.annotateCurrentSpan({ "push.skipped": "disabled" })
		return
	}
	// Another user claimed the token at or after our registration, and its forget has not landed
	// yet: the phone is theirs now. (A directory row older than ours is our own claim pending.)
	const sender = yield* CurrentEffectSender
	const owner = yield* tokenOwner(payload.token)
	if (
		sender.kind === "user" &&
		Option.isSome(owner) &&
		owner.value.userId !== sender.id &&
		owner.value.updatedAt.getTime() >= device.value.updatedAt.getTime()
	) {
		yield* unregisterDevice(payload.token, owner.value.updatedAt)
		yield* Effect.annotateCurrentSpan({ "push.skipped": "not-owner" })
		return
	}
	// The badge: what would make a sound, unread.
	const unread = yield* db.first(
		SQLite.from(schema.notificationsTable)
			.select(() => ({ count: SQLite.count() }))
			.where(($) => [$.readAt.isNull(), $.silent.eq(false)]),
	)
	const sentAt = new Date(nowMs)
	const result = yield* apns.send({
		environment: device.value.environment,
		token: payload.token,
		topic: device.value.bundleId,
		expiration: Math.floor((notification.value.createdAt.getTime() + PUSH_EXPIRATION_MS) / 1000),
		// A retry after a lost answer replaces the first copy on the phone.
		collapseId: payload.notificationId,
		payload: {
			aps: {
				alert: { title: payload.title, body: payload.body },
				sound: "default",
				badge: Option.match(unread, { onNone: () => 0, onSome: (row) => Number(row.count) }),
				"thread-id": payload.channelId,
			},
			hazel: {
				path: payload.path,
				channelId: payload.channelId,
				notificationId: payload.notificationId,
			},
		},
	})
	const outcome = apnsOutcome(result)
	yield* Effect.annotateCurrentSpan({
		"apns.environment": device.value.environment,
		"apns.status": result.status,
		"apns.reason": result.reason ?? "",
		"push.outcome": outcome,
	})
	switch (outcome) {
		case "Delivered":
			return
		case "Unregistered":
			// Not a registration that came in while this send was out.
			yield* unregisterDevice(payload.token, sentAt)
			return
		case "ProviderToken":
			return yield* new ApnsRetryableError({ status: result.status, reason: result.reason })
		case "Misconfigured":
			yield* Effect.logError(
				"APNs refused the provider token: check APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY",
			)
			return
		case "Retry":
			return yield* new ApnsRetryableError({ status: result.status, reason: result.reason })
		case "Rejected":
			yield* Effect.logWarning("APNs refused a push", { status: result.status, reason: result.reason })
			return
	}
})

export const pushReceivers = {
	"push.send": sendPush,
} satisfies EffectReceivers<
	typeof PushEffects,
	Database.Database | ApnsClient | Directory | CurrentEffectSender
>
