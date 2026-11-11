import { describe, expect, it } from "vitest"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { cachedRecoverable } from "./cached-recoverable.ts"

describe("cachedRecoverable", () => {
	it("builds once and shares the success", async () => {
		let builds = 0
		const program = Effect.gen(function* () {
			const get = yield* cachedRecoverable(Effect.sync(() => ++builds))
			return [yield* get, yield* get]
		})
		expect(await Effect.runPromise(program)).toEqual([1, 1])
		expect(builds).toBe(1)
	})

	it("forgets failures so the next call rebuilds", async () => {
		let builds = 0
		const program = Effect.gen(function* () {
			const get = yield* cachedRecoverable(
				Effect.suspend(() => (++builds === 1 ? Effect.fail("boom") : Effect.succeed(builds))),
			)
			const first = yield* Effect.exit(get)
			return [first, yield* get] as const
		})
		const [first, second] = await Effect.runPromise(program)
		expect(Exit.isFailure(first)).toBe(true)
		expect(second).toBe(2)
	})

	it("a waiter rebuilds when the in-flight build is interrupted", async () => {
		let builds = 0
		const program = Effect.gen(function* () {
			const gate = yield* Deferred.make<void>()
			const get = yield* cachedRecoverable(
				Effect.suspend(() => {
					builds++
					return builds === 1
						? Effect.andThen(Deferred.await(gate), Effect.succeed(1))
						: Effect.succeed(builds)
				}),
			)
			const builder = yield* Effect.forkChild(get)
			yield* Effect.yieldNow
			const waiter = yield* Effect.forkChild(get)
			yield* Effect.yieldNow
			yield* Fiber.interrupt(builder)
			return yield* Fiber.join(waiter)
		})
		expect(await Effect.runPromise(program)).toBe(2)
	})
})
