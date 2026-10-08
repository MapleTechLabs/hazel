import { ChannelId, UserId } from "@hazel/schema"
import { Clock, Duration, Effect, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { localActivity, remoteActivity } from "./activity"
import { Message } from "./message"
import { AFK_TIMEOUT_MS, HEARTBEAT_INTERVAL, type Model, SYNC_DEBOUNCE } from "./model"

/** What the root hands presence: the org layout's user (null outside it) and the route channel. */
export interface Input {
	readonly model: Model
	readonly userId: UserId | null
	readonly activeChannelId: ChannelId | null
}

const isRunning = (input: Input) => input.model.userId !== null

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	// The provider mounting, unmounting or the route channel changing.
	context: entry(
		{ userId: Schema.NullOr(UserId), activeChannelId: Schema.NullOr(ChannelId) },
		{
			modelToDependencies: (input) => ({
				userId: input.userId,
				activeChannelId: input.activeChannelId,
			}),
			dependenciesToStream: ({ userId, activeChannelId }) =>
				Stream.fromEffect(
					Clock.currentTimeMillis.pipe(
						Effect.map((nowMs) => Message.ChangedContext({ userId, activeChannelId, nowMs })),
					),
				),
		},
	),
	localActivity: entry(
		{ isRunning: Schema.Boolean },
		{
			modelToDependencies: (input) => ({ isRunning: isRunning(input) }),
			dependenciesToStream: ({ isRunning }) =>
				isRunning
					? localActivity.pipe(Stream.map((atMs) => Message.DetectedActivity({ atMs })))
					: Stream.empty,
		},
	),
	remoteActivity: entry(
		{ isRunning: Schema.Boolean },
		{
			modelToDependencies: (input) => ({ isRunning: isRunning(input) }),
			dependenciesToStream: ({ isRunning }) =>
				isRunning
					? remoteActivity.pipe(Stream.map((atMs) => Message.ReceivedRemoteActivity({ atMs })))
					: Stream.empty,
		},
	),
	// One timer for the latest activity's AFK deadline, instead of legacy's 5s polling.
	afkTimeout: entry(
		{ deadlineMs: Schema.NullOr(Schema.Number) },
		{
			modelToDependencies: (input) => ({
				deadlineMs:
					isRunning(input) && !input.model.isAfk
						? input.model.lastActivityMs + AFK_TIMEOUT_MS
						: null,
			}),
			dependenciesToStream: ({ deadlineMs }) =>
				deadlineMs === null
					? Stream.empty
					: Stream.fromEffect(
							Clock.currentTimeMillis.pipe(
								Effect.flatMap((nowMs) =>
									Effect.sleep(Duration.millis(Math.max(0, deadlineMs - nowMs))),
								),
								Effect.andThen(Clock.currentTimeMillis),
								Effect.map((nowMs) => Message.ReachedAfkTimeout({ nowMs })),
							),
						),
		},
	),
	// The 300ms debounce before each `userPresenceStatus.update`; a new version restarts it.
	syncDebounce: entry(
		{ version: Schema.NullOr(Schema.Number) },
		{
			modelToDependencies: (input) => ({
				version: input.model.isSyncPending ? input.model.syncVersion : null,
			}),
			dependenciesToStream: ({ version }) =>
				version === null
					? Stream.empty
					: Stream.fromEffect(
							Effect.sleep(SYNC_DEBOUNCE).pipe(
								Effect.as(Message.ElapsedSyncDebounce({ version })),
							),
						),
		},
	),
	// `heartbeatAtom`: one ping on mount, then every 15s.
	heartbeat: entry(
		{ isRunning: Schema.Boolean },
		{
			modelToDependencies: (input) => ({ isRunning: isRunning(input) }),
			dependenciesToStream: ({ isRunning }) =>
				isRunning
					? Stream.tick(HEARTBEAT_INTERVAL).pipe(Stream.map(() => Message.TickedHeartbeat()))
					: Stream.empty,
		},
	),
}))
