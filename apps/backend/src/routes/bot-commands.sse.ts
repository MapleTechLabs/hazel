import { Sse } from "effect/encoding"
import { Duration, Effect, Queue, Schedule, Stream } from "effect"

const HEARTBEAT_INTERVAL = "25 seconds" as const

const encodeSseEvent = (event: string, data: string) =>
	Sse.encoder.write({
		_tag: "Event",
		event,
		id: undefined,
		data,
	})

export type CommandSseRedis = {
	readonly subscribe: (
		channel: string,
		handler: (message: string, channel: string) => void,
	) => Effect.Effect<
		{
			readonly unsubscribe: Effect.Effect<void, unknown>
		},
		unknown
	>
}

export const createSseHeartbeatStream = (interval: Duration.Input = HEARTBEAT_INTERVAL) =>
	Stream.make(
		encodeSseEvent(
			"heartbeat",
			JSON.stringify({
				type: "heartbeat",
				timestamp: Date.now(),
			}),
		),
	).pipe(
		Stream.concat(
			Stream.fromSchedule(Schedule.spaced(interval)).pipe(
				Stream.map(() =>
					encodeSseEvent(
						"heartbeat",
						JSON.stringify({
							type: "heartbeat",
							timestamp: Date.now(),
						}),
					),
				),
			),
		),
	)

interface CommandSseStreamOptions {
	readonly botId: string
	readonly botName: string
	readonly channel: string
	readonly redis: CommandSseRedis
	readonly heartbeatInterval?: Duration.Input
}

export const createCommandSseStream = ({
	botId,
	botName,
	channel,
	redis,
	heartbeatInterval = HEARTBEAT_INTERVAL,
}: CommandSseStreamOptions) => {
	const commandStream = Stream.callback<string>((queue) =>
		Effect.gen(function* () {
			const { unsubscribe } = yield* redis.subscribe(channel, (message) => {
				Queue.offerUnsafe(queue, encodeSseEvent("command", message))
			})

			yield* Effect.addFinalizer(() =>
				unsubscribe.pipe(
					Effect.tap(() =>
						Effect.logDebug(`Bot ${botId} (${botName}) disconnected from SSE stream`),
					),
					Effect.catch(() => Effect.void),
				),
			)

			yield* Effect.never
		}).pipe(
			Effect.catch((error) => {
				Effect.runFork(Effect.logError("Redis subscription error", { error, botId, botName }))
				return Queue.end(queue)
			}),
		),
	)

	return Stream.merge(commandStream, createSseHeartbeatStream(heartbeatInterval), {
		haltStrategy: "either",
	})
}
