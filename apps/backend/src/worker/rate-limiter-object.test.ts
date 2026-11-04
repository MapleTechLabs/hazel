import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { MESSAGE_RATE_LIMIT, checkMessageRateLimit } from "../services/rate-limit-helpers"
import { RateLimiter } from "../services/rate-limiter"
import { type MessageRateLimit, type RateLimiterBackends, rateLimiterLive } from "./rate-limiter-object"

/** The binding's client, admitting `allowed` calls per key. */
const fakeBinding = (allowed: number) => {
	const counts = new Map<string, number>()
	const client: MessageRateLimit = {
		limit: ({ key }) =>
			Effect.sync(() => {
				const count = (counts.get(key) ?? 0) + 1
				counts.set(key, count)
				return { success: count <= allowed }
			}),
	}
	return { client, counts }
}

/** The Durable Object namespace, recording which keys reached it. */
const fakeObjects = () => {
	const keys: Array<string> = []
	const namespace: RateLimiterBackends = {
		getByName: (key) => ({
			consume: (limit, windowMs) =>
				Effect.sync(() => {
					keys.push(key)
					return { allowed: true, remaining: limit - 1, resetAfterMs: windowMs, limit }
				}),
		}),
	}
	return { namespace, keys }
}

describe("rateLimiterLive", () => {
	it("counts messages with the rate limit binding and the rest with their object", async () => {
		const binding = fakeBinding(1)
		const objects = fakeObjects()
		const layer = rateLimiterLive(objects.namespace, binding.client)

		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const limiter = yield* RateLimiter
				const first = yield* limiter.consume("messages:u1", 120, 60_000)
				const second = yield* limiter.consume("messages:u1", 120, 60_000)
				const bot = yield* limiter.consume("bot-operations:u1", 10, 3_600_000)
				return { first, second, bot }
			}).pipe(Effect.provide(layer)),
		)
		expect(results.first.allowed).toBe(true)
		expect(results.second).toMatchObject({ allowed: false, remaining: 0 })
		expect(results.bot.allowed).toBe(true)
		expect(binding.counts.get("messages:u1")).toBe(2)
		expect(objects.keys).toEqual(["bot-operations:u1"])
	})

	it("refuses a message past the limit", async () => {
		const binding = fakeBinding(0)
		const exit = await Effect.runPromiseExit(
			checkMessageRateLimit("u1").pipe(
				Effect.provide(rateLimiterLive(fakeObjects().namespace, binding.client)),
			),
		)
		expect(exit._tag).toBe("Failure")
		expect(MESSAGE_RATE_LIMIT.windowMs).toBe(MESSAGE_RATE_LIMIT.periodSeconds * 1000)
	})
})
