import { ChannelId, UserId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { catchCommon } from "../../data/actions"
import { HazelRpc } from "../../rpc"
import { broadcastActivity } from "./activity"
import { Message } from "./message"
import {
	computedStatusOf,
	isAfkAt,
	type Model,
	payloadOf,
	PresenceStatus,
	reportedChannelIdOf,
	Sent,
	syncRetryDelayMs,
} from "./model"

export type Return = Update.Return<Model, Message, HazelRpc>

// COMMANDS

/** Writes `status` and/or `activeChannelId`; on success the server holds `snapshot`. */
export const SendPresenceUpdate = Command.define("SendPresenceUpdate", {
	args: {
		userId: UserId,
		snapshot: Sent,
		status: Schema.optionalKey(PresenceStatus),
		activeChannelId: Schema.optionalKey(Schema.NullOr(ChannelId)),
	},
	messages: [Message.SucceededSendPresenceUpdate, Message.FailedSendPresenceUpdate],
	execute: ({ userId, snapshot, ...payload }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.update", payload)
			return Message.SucceededSendPresenceUpdate({ userId, sent: snapshot })
		}).pipe(catchCommon((reason) => Message.FailedSendPresenceUpdate({ userId, reason }))),
})

/** Waits out the backoff after a failed write. */
export const WaitSyncRetry = Command.define("WaitSyncRetry", {
	args: { userId: UserId, delayMs: Schema.Number },
	messages: [Message.ElapsedSyncRetry],
	execute: ({ userId, delayMs }) =>
		Effect.sleep(Duration.millis(delayMs)).pipe(Effect.as(Message.ElapsedSyncRetry({ userId }))),
})

export const SendHeartbeat = Command.define("SendHeartbeat", {
	messages: [Message.SucceededSendHeartbeat, Message.FailedSendHeartbeat],
	execute: Effect.gen(function* () {
		const client = yield* HazelRpc
		yield* client("userPresenceStatus.heartbeat", {})
		return Message.SucceededSendHeartbeat()
	}).pipe(catchCommon((reason) => Message.FailedSendHeartbeat({ reason }))),
})

export const BroadcastActivity = Command.define("BroadcastActivity", {
	args: { atMs: Schema.Number },
	messages: [Message.CompletedBroadcastActivity],
	execute: ({ atMs }) => broadcastActivity(atMs).pipe(Effect.as(Message.CompletedBroadcastActivity())),
})

// UPDATE

const bumpSync = (model: Model): Model =>
	modifyFields(model, { syncVersion: (version) => version + 1, isSyncPending: () => true })

/** Restarts the debounce on mount (a new user) and whenever the status or channel moved. */
const scheduleSync = (previous: Model, next: Model): Return => {
	const isDue =
		next.userId !== null &&
		(previous.userId !== next.userId ||
			computedStatusOf(previous) !== computedStatusOf(next) ||
			reportedChannelIdOf(previous) !== reportedChannelIdOf(next))
	return { model: isDue ? bumpSync(next) : next }
}

const withActivity = (model: Model, atMs: number): Model =>
	atMs <= model.lastActivityMs
		? model
		: modifyFields(model, { lastActivityMs: () => atMs, isAfk: () => isAfkAt(atMs, atMs) })

/** `usePresence().setStatus`: the picked status wins over AFK until another is picked. */
export const pickStatus = (model: Model, status: PresenceStatus): Return =>
	scheduleSync(model, modifyFields(model, { manualStatus: () => status }))

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ChangedContext: ({ userId, activeChannelId, nowMs }) => {
			// Leaving the layout unmounts the provider: the next mount sends a fresh initial update.
			const isSameUser = userId !== null && userId === model.userId
			const lastActivityMs = model.lastActivityMs === 0 ? nowMs : model.lastActivityMs
			return scheduleSync(
				model,
				modifyFields(model, {
					userId: () => userId,
					activeChannelId: () => activeChannelId,
					lastActivityMs: () => lastActivityMs,
					isAfk: () => isAfkAt(lastActivityMs, nowMs),
					sent: (sent) => (isSameUser ? sent : null),
					failedSyncs: (failed) => (isSameUser ? failed : 0),
				}),
			)
		},
		ChangedWindowFocus: ({ isFocused }) =>
			scheduleSync(model, modifyFields(model, { isWindowFocused: () => isFocused })),
		DetectedActivity: ({ atMs }) => {
			const result = scheduleSync(model, withActivity(model, atMs))
			return {
				model: result.model,
				commands: [...(result.commands ?? []), BroadcastActivity({ atMs })],
			}
		},
		ReceivedRemoteActivity: ({ atMs }) => scheduleSync(model, withActivity(model, atMs)),
		ReachedAfkTimeout: ({ nowMs }) =>
			scheduleSync(model, modifyFields(model, { isAfk: () => isAfkAt(model.lastActivityMs, nowMs) })),
		ElapsedSyncDebounce: ({ version }) => {
			if (version !== model.syncVersion || !model.isSyncPending) return { model }
			const settled = modifyFields(model, { isSyncPending: () => false })
			const payload = model.userId === null ? null : payloadOf(model)
			if (model.userId === null || payload === null) return { model: settled }
			return {
				model: settled,
				commands: [
					SendPresenceUpdate({
						userId: model.userId,
						snapshot: {
							status: computedStatusOf(model),
							activeChannelId: reportedChannelIdOf(model),
						},
						...payload,
					}),
				],
			}
		},
		// `sent` moves only once the server has the write, so a failed one is retried, not forgotten.
		SucceededSendPresenceUpdate: ({ userId, sent }) =>
			userId === model.userId
				? { model: modifyFields(model, { sent: () => sent, failedSyncs: () => 0 }) }
				: { model },
		FailedSendPresenceUpdate: ({ userId }) => {
			if (userId !== model.userId) return { model }
			const failedSyncs = model.failedSyncs + 1
			return {
				model: modifyFields(model, { failedSyncs: () => failedSyncs }),
				commands: [WaitSyncRetry({ userId, delayMs: syncRetryDelayMs(failedSyncs) })],
			}
		},
		ElapsedSyncRetry: ({ userId }) => (userId === model.userId ? { model: bumpSync(model) } : { model }),
		TickedHeartbeat: () =>
			model.isHeartbeatInFlight || model.userId === null
				? { model }
				: {
						model: modifyFields(model, { isHeartbeatInFlight: () => true }),
						commands: [SendHeartbeat()],
					},
		SucceededSendHeartbeat: () => ({ model: modifyFields(model, { isHeartbeatInFlight: () => false }) }),
		// The next tick pings again; a missed heartbeat only ages `lastSeenAt` a little.
		FailedSendHeartbeat: () => ({ model: modifyFields(model, { isHeartbeatInFlight: () => false }) }),
		CompletedBroadcastActivity: () => ({ model }),
	})
