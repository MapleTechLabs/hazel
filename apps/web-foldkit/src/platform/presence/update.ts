import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../rpc"
import { broadcastActivity } from "./activity"
import { Message } from "./message"
import { ComputedStatus, computedStatusOf, isAfkAt, type Model, payloadOf } from "./model"

export type Return = Update.Return<Model, Message, HazelRpc>

// COMMANDS

export const SendPresenceUpdate = Command.define("SendPresenceUpdate", {
	args: {
		status: Schema.optionalKey(ComputedStatus),
		activeChannelId: Schema.optionalKey(Schema.NullOr(ChannelId)),
	},
	messages: [Message.SucceededSendPresenceUpdate, Message.FailedSendPresenceUpdate],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.update", payload)
			return Message.SucceededSendPresenceUpdate()
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed(Message.FailedSendPresenceUpdate({ reason: String(error) })),
			),
		),
})

export const SendHeartbeat = Command.define("SendHeartbeat", {
	args: {},
	messages: [Message.SucceededSendHeartbeat, Message.FailedSendHeartbeat],
	execute: () =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.heartbeat", {})
			return Message.SucceededSendHeartbeat()
		}).pipe(
			Effect.catch((error) => Effect.succeed(Message.FailedSendHeartbeat({ reason: String(error) }))),
		),
})

export const BroadcastActivity = Command.define("BroadcastActivity", {
	args: { atMs: Schema.Number },
	messages: [Message.CompletedBroadcastActivity],
	execute: ({ atMs }) => broadcastActivity(atMs).pipe(Effect.as(Message.CompletedBroadcastActivity())),
})

// UPDATE

/** Restarts the debounce on mount (a new user) and whenever the status or channel moved. */
const scheduleSync = (previous: Model, next: Model): Return => {
	const isDue =
		next.userId !== null &&
		(previous.userId !== next.userId ||
			computedStatusOf(previous) !== computedStatusOf(next) ||
			previous.activeChannelId !== next.activeChannelId)
	if (!isDue) return { model: next }
	return { model: modifyFields(next, { syncVersion: (version) => version + 1, isSyncPending: () => true }) }
}

const withActivity = (model: Model, atMs: number): Model =>
	atMs <= model.lastActivityMs
		? model
		: modifyFields(model, { lastActivityMs: () => atMs, isAfk: () => isAfkAt(atMs, atMs) })

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
				}),
			)
		},
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
			if (payload === null) return { model: settled }
			return {
				model: modifyFields(settled, {
					sent: () => ({ status: computedStatusOf(model), activeChannelId: model.activeChannelId }),
				}),
				commands: [SendPresenceUpdate(payload)],
			}
		},
		SucceededSendPresenceUpdate: () => ({ model }),
		FailedSendPresenceUpdate: () => ({ model }),
		TickedHeartbeat: () =>
			model.isHeartbeatInFlight || model.userId === null
				? { model }
				: {
						model: modifyFields(model, { isHeartbeatInFlight: () => true }),
						commands: [SendHeartbeat({})],
					},
		SucceededSendHeartbeat: () => ({ model: modifyFields(model, { isHeartbeatInFlight: () => false }) }),
		FailedSendHeartbeat: () => ({ model: modifyFields(model, { isHeartbeatInFlight: () => false }) }),
		CompletedBroadcastActivity: () => ({ model }),
	})
