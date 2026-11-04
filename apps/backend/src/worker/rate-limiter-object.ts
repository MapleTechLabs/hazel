/**
 * Fixed-window rate limiting, one Durable Object per limit key: the same semantics as the Redis
 * Lua script in `services/rate-limiter.ts`, with the object's single-threaded execution standing
 * in for the script's atomicity.
 */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Effect, Layer } from "effect"
import { MESSAGE_RATE_LIMIT_KEY_PREFIX } from "../services/rate-limit-helpers"
import { type RateLimitResult, RateLimiter, RateLimiterError } from "../services/rate-limiter"

interface WindowState {
	readonly startedAt: number
	readonly count: number
}

export interface RateLimiterShape {
	readonly consume: (limit: number, windowMs: number) => Effect.Effect<RateLimitResult>
}

export class RateLimiterObject extends Cloudflare.DurableObject<RateLimiterObject, RateLimiterShape>()(
	"RateLimiter",
) {}

const WINDOW_KEY = "window"

export const RateLimiterObjectLive = RateLimiterObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		return Effect.gen(function* () {
			// Cached across calls; storage keeps it across evictions.
			let current = yield* state.storage.get<WindowState>(WINDOW_KEY)

			return {
				consume: (limit: number, windowMs: number) =>
					Effect.gen(function* () {
						const now = Date.now()
						if (current === undefined || now - current.startedAt >= windowMs) {
							current = { startedAt: now, count: 0 }
						}
						const resetAfterMs = Math.max(0, current.startedAt + windowMs - now)
						if (current.count >= limit) {
							return {
								allowed: false,
								remaining: 0,
								resetAfterMs,
								limit,
							} satisfies RateLimitResult
						}
						current = { startedAt: current.startedAt, count: current.count + 1 }
						yield* state.storage.put(WINDOW_KEY, current)
						return {
							allowed: true as boolean,
							remaining: limit - current.count,
							resetAfterMs,
							limit,
						}
					}).pipe(Effect.provide(RuntimeContext.phantom)),
			}
		})
	}),
)

/**
 * The `RateLimiter` port: message keys go to Cloudflare's rate limit binding, counted in the
 * colo that handles the request with no round trip; every other key (hourly limits the binding's
 * 10 or 60 s period cannot express, on rare operations) to its Durable Object, whose first call
 * after an idle spell wakes it, costing up to a second on the request.
 */
/** What `rateLimiterLive` uses of the Durable Object namespace and of the binding's client. */
export interface RateLimiterBackends {
	readonly getByName: (key: string) => {
		readonly consume: (
			limit: number,
			windowMs: number,
		) => Effect.Effect<RateLimitResult, never, RuntimeContext>
	}
}
export type MessageRateLimit = Pick<Cloudflare.RateLimitClient, "limit">

export const rateLimiterLive = (limiters: RateLimiterBackends, messages: MessageRateLimit) =>
	Layer.succeed(
		RateLimiter,
		RateLimiter.of({
			consume: (key, limit, windowMs) =>
				(key.startsWith(MESSAGE_RATE_LIMIT_KEY_PREFIX)
					? messages.limit({ key }).pipe(
							Effect.map(({ success }): RateLimitResult => ({
								allowed: success,
								// The binding does not say how many are left, nor when its window ends.
								remaining: success ? limit : 0,
								resetAfterMs: windowMs,
								limit,
							})),
							Effect.mapError(
								(error) => new RateLimiterError({ message: error.message, cause: error }),
							),
						)
					: limiters.getByName(key).consume(limit, windowMs)
				)
					// Discharge alchemy's phantom color: handlers run inside a Worker event.
					.pipe(Effect.provide(RuntimeContext.phantom)),
		}),
	)
