import { Redis, type RedisErrors } from "@hazel/effect-bun"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
	/** Whether the request is allowed */
	readonly allowed: boolean
	/** Number of requests remaining in the current window */
	readonly remaining: number
	/** Milliseconds until the rate limit resets */
	readonly resetAfterMs: number
	/** Maximum requests allowed per window */
	readonly limit: number
}

export class RateLimiterError extends Schema.TaggedError<RateLimiterError>()("RateLimiterError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Fixed-window rate limiting Lua script.
 *
 * This script atomically:
 * 1. Gets the current count for the key
 * 2. If no key exists, creates it with count=1 and TTL=windowMs
 * 3. If key exists and count < limit, increments and returns allowed
 * 4. If key exists and count >= limit, returns denied with TTL info
 *
 * Returns: [allowed (0/1), remaining, resetAfterMs]
 */
const FIXED_WINDOW_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local current = tonumber(redis.call("GET", key) or "0")
local ttl = tonumber(redis.call("PTTL", key))

if ttl < 0 then
  ttl = windowMs
end

if current < limit then
  if current == 0 then
    redis.call("SET", key, 1, "PX", windowMs)
  else
    redis.call("INCR", key)
  end
  return {1, limit - current - 1, ttl}
else
  return {0, 0, ttl}
end
`

/**
 * Rate limiter service backed by Redis via @hazel/effect-bun
 */
export class RateLimiter extends Context.Service<RateLimiter>()("RateLimiter", {
	make: Effect.gen(function* () {
		const redis = yield* Redis

		return {
			/**
			 * Check and consume from a rate limit bucket using fixed-window algorithm.
			 *
			 * @param key - Unique key for this rate limit (e.g., "messages:user-123")
			 * @param limit - Maximum requests allowed per window
			 * @param windowMs - Window duration in milliseconds
			 * @returns RateLimitResult with allowed status and metadata
			 */
			consume: (key: string, limit: number, windowMs: number) =>
				redis
					.send<[number, number, number]>("EVAL", [
						FIXED_WINDOW_SCRIPT,
						"1",
						`ratelimit:${key}`,
						String(limit),
						String(windowMs),
					])
					.pipe(
						Effect.map(([allowed, remaining, resetAfterMs]) => ({
							allowed: allowed === 1,
							remaining,
							resetAfterMs,
							limit,
						})),
						Effect.mapError(
							(e: RedisErrors) =>
								new RateLimiterError({
									message: "Failed to execute rate limit check",
									cause: e,
								}),
						),
					),
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Redis.Default))
}

/**
 * In-memory rate limiter for testing (no Redis required)
 */
const memoryStore = new Map<string, number>()

export const RateLimiterMemoryLive = Layer.succeed(
	RateLimiter,
	RateLimiter.of({
		consume: (key: string, limit: number, windowMs: number) =>
			Effect.sync(() => {
				// Simple in-memory implementation using a Map
				const now = Date.now()
				const windowKey = `${key}:${Math.floor(now / windowMs)}`

				if (!memoryStore.has(windowKey)) {
					memoryStore.set(windowKey, 1)
					// Clean up old keys periodically
					setTimeout(() => memoryStore.delete(windowKey), windowMs)
					return {
						allowed: true,
						remaining: limit - 1,
						resetAfterMs: windowMs - (now % windowMs),
						limit,
					}
				}

				const current = memoryStore.get(windowKey)!
				if (current < limit) {
					memoryStore.set(windowKey, current + 1)
					return {
						allowed: true,
						remaining: limit - current - 1,
						resetAfterMs: windowMs - (now % windowMs),
						limit,
					}
				}

				return {
					allowed: false,
					remaining: 0,
					resetAfterMs: windowMs - (now % windowMs),
					limit,
				}
			}),
	}),
)
