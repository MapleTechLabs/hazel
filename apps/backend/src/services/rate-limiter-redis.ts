import { Redis, type RedisErrors } from "@hazel/effect-bun"
import { Effect, Layer } from "effect"
import { RateLimiter, RateLimiterError } from "./rate-limiter"

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

/** `RateLimiter` backed by Redis (the Bun entry). */
export const RateLimiterRedisLive = Layer.effect(
	RateLimiter,
	Effect.gen(function* () {
		const redis = yield* Redis

		return RateLimiter.of({
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
		})
	}),
).pipe(Layer.provide(Redis.Default))
