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
 * Fixed-window rate limiting. Implementations: a Durable Object per key
 * (`worker/rate-limiter-object.ts`), memory in tests.
 */
export class RateLimiter extends Context.Service<
	RateLimiter,
	{
		/**
		 * Check and consume from a rate limit bucket using fixed-window algorithm.
		 *
		 * @param key - Unique key for this rate limit (e.g., "messages:user-123")
		 * @param limit - Maximum requests allowed per window
		 * @param windowMs - Window duration in milliseconds
		 * @returns RateLimitResult with allowed status and metadata
		 */
		readonly consume: (
			key: string,
			limit: number,
			windowMs: number,
		) => Effect.Effect<RateLimitResult, RateLimiterError>
	}
>()("RateLimiter") {}

/**
 * Admits everything: for handlers running in an object or on the api Worker's directory path,
 * behind the api Worker's routing, which already applied the limit (`rpc/routing.ts`).
 */
export const RateLimiterAllowAll = Layer.succeed(
	RateLimiter,
	RateLimiter.of({
		consume: (_key, limit, windowMs) =>
			Effect.succeed({ allowed: true, remaining: limit, resetAfterMs: windowMs, limit }),
	}),
)
