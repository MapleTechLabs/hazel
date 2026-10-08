import { ChannelId, UserId } from "@hazel/schema"
import { Duration, Option, Schema } from "effect"

/** Port of `hooks/use-presence.ts`: the signed-in user's own status, AFK and heartbeat. */

export const AFK_TIMEOUT_MS = Duration.toMillis(Duration.minutes(15))
export const HEARTBEAT_INTERVAL = Duration.seconds(15)
export const ACTIVITY_THROTTLE_MS = 1_000
export const SYNC_DEBOUNCE = Duration.millis(300)

/** The statuses a user can pick (legacy `PresenceStatus` in the palette's `StatusView`). */
export const PresenceStatus = Schema.Literals(["online", "away", "busy", "dnd"])
export type PresenceStatus = typeof PresenceStatus.Type

/** What was last written with `userPresenceStatus.update` (legacy `previousValuesRef`). */
export const Sent = Schema.Struct({
	status: PresenceStatus,
	activeChannelId: Schema.NullOr(ChannelId),
})
export type Sent = typeof Sent.Type

export const Model = Schema.Struct({
	/** The user `PresenceProvider` runs for: set inside the loaded org layout, null elsewhere. */
	userId: Schema.NullOr(UserId),
	/** `currentChannelIdAtom`. */
	activeChannelId: Schema.NullOr(ChannelId),
	/** `lastActivityAtom`; 0 until the first context or activity arrives. */
	lastActivityMs: Schema.Number,
	isAfk: Schema.Boolean,
	/** `manualStatusAtom`: a status picked in the palette, ahead of the AFK-derived one. */
	manualStatus: Schema.NullOr(PresenceStatus),
	/** Null until the initial update of this mount has been written. */
	sent: Schema.NullOr(Sent),
	/** Bumped on every change; the debounce Subscription restarts on each bump. */
	syncVersion: Schema.Number,
	isSyncPending: Schema.Boolean,
	isHeartbeatInFlight: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	userId: null,
	activeChannelId: null,
	lastActivityMs: 0,
	isAfk: false,
	manualStatus: null,
	sent: null,
	syncVersion: 0,
	isSyncPending: false,
	isHeartbeatInFlight: false,
})

/** `computedPresenceStatusAtom`: a manual status overrides the AFK-derived away/online. */
export const computedStatusOf = (model: Model): PresenceStatus =>
	model.manualStatus ?? (model.isAfk ? "away" : "online")

export const isAfkAt = (lastActivityMs: number, nowMs: number) => nowMs - lastActivityMs >= AFK_TIMEOUT_MS

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** `currentChannelIdAtom`: the segment after `chat` in `/$orgSlug/chat/$id/...`. */
export const channelIdOfPathname = (pathname: string): ChannelId | null => {
	const segments = pathname.split("/")
	const chatIndex = segments.indexOf("chat")
	const segment = chatIndex !== -1 && chatIndex < segments.length - 1 ? segments[chatIndex + 1] : undefined
	return segment === undefined ? null : Option.getOrNull(decodeChannelId(segment))
}

export type UpdatePayload = {
	readonly status?: PresenceStatus
	readonly activeChannelId?: ChannelId | null
}

/** The first write of a mount carries both fields; later ones only what changed (or nothing). */
export const payloadOf = (model: Model): UpdatePayload | null => {
	const status = computedStatusOf(model)
	const { sent, activeChannelId } = model
	if (sent === null) return { status, activeChannelId }
	const isStatusChanged = sent.status !== status
	const isChannelChanged = sent.activeChannelId !== activeChannelId
	if (!isStatusChanged && !isChannelChanged) return null
	return {
		...(isStatusChanged ? { status } : {}),
		...(isChannelChanged ? { activeChannelId } : {}),
	}
}
