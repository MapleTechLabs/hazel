import { ChannelId, UserId } from "@hazel/schema"
import { Duration, Schema } from "effect"

/** Port of `hooks/use-presence.ts`: the signed-in user's own status, AFK and heartbeat. */

export const AFK_TIMEOUT_MS = Duration.toMillis(Duration.minutes(15))
export const HEARTBEAT_INTERVAL = Duration.seconds(15)
export const ACTIVITY_THROTTLE_MS = 1_000
export const SYNC_DEBOUNCE = Duration.millis(300)
/** After a failed write the sync runs again after this long, doubling per failure up to the cap. */
export const SYNC_RETRY_BASE_MS = 2_000
export const SYNC_RETRY_MAX_MS = 60_000

/** The statuses a user can pick (legacy `PresenceStatus` in the palette's `StatusView`). */
export const PresenceStatus = Schema.Literals(["online", "away", "busy", "dnd"])
export type PresenceStatus = typeof PresenceStatus.Type

/** What the server holds after a `userPresenceStatus.update` it confirmed (legacy `previousValuesRef`). */
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
	/** Window focused and document visible; while not, the server is told no channel is open. */
	isWindowFocused: Schema.Boolean,
	/** `lastActivityAtom`; 0 until the first context or activity arrives. */
	lastActivityMs: Schema.Number,
	isAfk: Schema.Boolean,
	/** `manualStatusAtom`: a status picked in the palette, ahead of the AFK-derived one. */
	manualStatus: Schema.NullOr(PresenceStatus),
	/** The last write the server confirmed; null until this mount's first write lands. */
	sent: Schema.NullOr(Sent),
	/** Writes that failed in a row; each failure re-syncs after a growing backoff. */
	failedSyncs: Schema.Number,
	/** Bumped on every change; the debounce Subscription restarts on each bump. */
	syncVersion: Schema.Number,
	isSyncPending: Schema.Boolean,
	isHeartbeatInFlight: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	userId: null,
	activeChannelId: null,
	isWindowFocused: true,
	lastActivityMs: 0,
	isAfk: false,
	manualStatus: null,
	sent: null,
	failedSyncs: 0,
	syncVersion: 0,
	isSyncPending: false,
	isHeartbeatInFlight: false,
})

/** `computedPresenceStatusAtom`: a manual status overrides the AFK-derived away/online. */
export const computedStatusOf = (model: Model): PresenceStatus =>
	model.manualStatus ?? (model.isAfk ? "away" : "online")

/**
 * The channel the server is told the user is reading. The server skips notifications for that
 * channel, so a window in the background reports none and its messages still notify (and play).
 */
export const reportedChannelIdOf = (model: Model): ChannelId | null =>
	model.isWindowFocused ? model.activeChannelId : null

export const isAfkAt = (lastActivityMs: number, nowMs: number) => nowMs - lastActivityMs >= AFK_TIMEOUT_MS

/** The backoff before re-syncing after `failedSyncs` failed writes in a row. */
export const syncRetryDelayMs = (failedSyncs: number) =>
	Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** Math.max(0, failedSyncs - 1))

export type UpdatePayload = {
	readonly status?: PresenceStatus
	readonly activeChannelId?: ChannelId | null
}

/** The first write of a mount carries both fields; later ones only what changed since the last confirmed one. */
export const payloadOf = (model: Model): UpdatePayload | null => {
	const status = computedStatusOf(model)
	const { sent } = model
	const activeChannelId = reportedChannelIdOf(model)
	if (sent === null) return { status, activeChannelId }
	const isStatusChanged = sent.status !== status
	const isChannelChanged = sent.activeChannelId !== activeChannelId
	if (!isStatusChanged && !isChannelChanged) return null
	return {
		...(isStatusChanged ? { status } : {}),
		...(isChannelChanged ? { activeChannelId } : {}),
	}
}
