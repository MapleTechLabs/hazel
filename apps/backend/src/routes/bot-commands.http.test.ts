import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { createSseHeartbeatStream } from "./bot-commands.sse.ts"

describe("bot command SSE streams", () => {
	it("emits an immediate heartbeat on connect", () =>
		Effect.gen(function* () {
			const eventsChunk = yield* createSseHeartbeatStream("25 seconds").pipe(
				Stream.take(1),
				Stream.runCollect,
			)
			const events = Array.from(eventsChunk)

			expect(events).toHaveLength(1)
			expect(events[0]).toContain("event: heartbeat")
		}).pipe(Effect.runPromise))

	it("continues sending heartbeats during idle periods", () =>
		Effect.gen(function* () {
			const fiber = yield* createSseHeartbeatStream("5 millis").pipe(
				Stream.take(3),
				Stream.runCollect,
				Effect.forkDetach,
			)

			const events = Array.from(yield* Fiber.join(fiber)) as string[]

			expect(events).toHaveLength(3)
			for (const event of events) {
				expect(event).toContain("event: heartbeat")
			}
		}).pipe(Effect.runPromise))
})
