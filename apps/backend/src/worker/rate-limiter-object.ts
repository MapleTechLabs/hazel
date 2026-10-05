/**
 * Fixed-window rate limiting, one Durable Object per limit key: the same semantics as the Redis
 * Lua script in `services/rate-limiter.ts`, with the object's single-threaded execution standing
 * in for the script's atomicity.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Effect, Layer } from "effect"
import { type RateLimitResult, RateLimiter } from "../services/rate-limiter"

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

/** The `RateLimiter` port over the Durable Object namespace the Worker bound. */
export const rateLimiterLive = (limiters: Cloudflare.DurableObject<RateLimiterObject>) =>
	Layer.succeed(
		RateLimiter,
		RateLimiter.of({
			consume: (key, limit, windowMs) =>
				limiters
					.getByName(key)
					.consume(limit, windowMs)
					// Discharge alchemy's phantom color: handlers run inside a Worker event.
					.pipe(Effect.provide(RuntimeContext.phantom)),
		}),
	)
