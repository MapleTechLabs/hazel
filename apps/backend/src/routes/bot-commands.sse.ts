import { Sse } from "effect/encoding"
import { Duration, Schedule, Stream } from "effect"

const HEARTBEAT_INTERVAL = "25 seconds" as const

const encodeSseEvent = (event: string, data: string) =>
	Sse.encoder.write({
		_tag: "Event",
		event,
		id: undefined,
		data,
	})

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
