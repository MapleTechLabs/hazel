/**
 * Rate Limit Helpers
 *
 * Helper functions for applying rate limiting in handlers.
 * These are used instead of middleware because the middleware system
 * doesn't support depending on context from previous middlewares.
 */

import { RateLimitExceededError } from "@hazel/domain"
import { Effect } from "effect"
import { RateLimiter } from "./rate-limiter"

/**
 * Rate limit configuration for messages: 120 a minute per user, per Cloudflare location. Counted
 * by Cloudflare's rate limit binding (`MESSAGE_RATE_LIMIT_BINDING` in `worker.ts`, configured
 * from this), which counts in each location on its own: a user whose requests reach two locations
 * within a minute gets up to the limit in each. That bounds abuse well enough for messages, and
 * costs no round trip; the strict, global hourly limits below stay on a Durable Object. The
 * binding's period is 10 or 60 s, so the window must stay one of those.
 */
export const MESSAGE_RATE_LIMIT = {
	limit: 120,
	periodSeconds: 60,
	windowMs: 60 * 1000,
} as const

/** The keys `checkMessageRateLimit` counts; the Worker sends them to the rate limit binding. */
export const MESSAGE_RATE_LIMIT_KEY_PREFIX = "messages:"

/**
 * Rate limit configuration for avatar uploads
 * 5 requests per hour per user
 */
export const AVATAR_RATE_LIMIT = {
	limit: 5,
	windowMs: 60 * 60 * 1000,
}

/**
 * Rate limit configuration for bot operations (create, install, uninstall, regenerateToken)
 * 10 requests per hour per user
 */
export const BOT_OPERATION_RATE_LIMIT = {
	limit: 10,
	windowMs: 60 * 60 * 1000,
}

/**
 * Rate limit configuration for bot updates
 * 30 requests per hour per user
 */
export const BOT_UPDATE_RATE_LIMIT = {
	limit: 30,
	windowMs: 60 * 60 * 1000,
}

/**
 * Check rate limit for message operations.
 * Call this at the start of message handlers.
 *
 * @param userId - The user ID to rate limit
 */
export const checkMessageRateLimit = Effect.fn("RateLimitHelpers.checkMessageRateLimit")(function* (
	userId: string,
) {
	const rateLimiter = yield* RateLimiter

	const result = yield* rateLimiter
		.consume(
			`${MESSAGE_RATE_LIMIT_KEY_PREFIX}${userId}`,
			MESSAGE_RATE_LIMIT.limit,
			MESSAGE_RATE_LIMIT.windowMs,
		)
		.pipe(
			Effect.catchTag("RateLimiterError", (error) =>
				Effect.gen(function* () {
					// Log the error but allow the request through (fail open)
					yield* Effect.logWarning("Rate limiter unavailable, allowing request", error)
					return {
						allowed: true,
						remaining: MESSAGE_RATE_LIMIT.limit,
						resetAfterMs: MESSAGE_RATE_LIMIT.windowMs,
						limit: MESSAGE_RATE_LIMIT.limit,
					}
				}),
			),
		)

	if (!result.allowed) {
		return yield* Effect.fail(
			new RateLimitExceededError({
				message: "Message rate limit exceeded. Please wait before sending more messages.",
				// At most this: the binding does not say when the window ends.
				retryAfterMs: result.resetAfterMs,
				limit: result.limit,
				remaining: 0,
			}),
		)
	}

	yield* Effect.logDebug(`Message rate limit check passed for user ${userId}`)
})

/**
 * Check rate limit for avatar upload operations.
 * Call this at the start of avatar upload handlers.
 *
 * @param userId - The user ID to rate limit
 */
export const checkAvatarRateLimit = Effect.fn("RateLimitHelpers.checkAvatarRateLimit")(function* (
	userId: string,
) {
	const rateLimiter = yield* RateLimiter

	const result = yield* rateLimiter
		.consume(`avatars:${userId}`, AVATAR_RATE_LIMIT.limit, AVATAR_RATE_LIMIT.windowMs)
		.pipe(
			Effect.catchTag("RateLimiterError", (error) =>
				Effect.gen(function* () {
					// Log the error but allow the request through (fail open)
					yield* Effect.logWarning("Rate limiter unavailable, allowing request", error)
					return {
						allowed: true,
						remaining: AVATAR_RATE_LIMIT.limit,
						resetAfterMs: AVATAR_RATE_LIMIT.windowMs,
						limit: AVATAR_RATE_LIMIT.limit,
					}
				}),
			),
		)

	if (!result.allowed) {
		return yield* Effect.fail(
			new RateLimitExceededError({
				message: "Avatar upload rate limit exceeded. Please wait before uploading again.",
				retryAfterMs: result.resetAfterMs,
				limit: result.limit,
				remaining: 0,
			}),
		)
	}

	yield* Effect.logDebug(
		`Avatar rate limit check passed for user ${userId}: ${result.remaining}/${result.limit} remaining`,
	)
})

/**
 * Check rate limit for bot operations (create, install, uninstall, regenerateToken).
 * Call this at the start of bot operation handlers.
 *
 * @param userId - The user ID to rate limit
 */
export const checkBotOperationRateLimit = Effect.fn("RateLimitHelpers.checkBotOperationRateLimit")(function* (
	userId: string,
) {
	const rateLimiter = yield* RateLimiter

	const result = yield* rateLimiter
		.consume(
			`bot-operations:${userId}`,
			BOT_OPERATION_RATE_LIMIT.limit,
			BOT_OPERATION_RATE_LIMIT.windowMs,
		)
		.pipe(
			Effect.catchTag("RateLimiterError", (error) =>
				Effect.gen(function* () {
					// Log the error but allow the request through (fail open)
					yield* Effect.logWarning("Rate limiter unavailable, allowing request", error)
					return {
						allowed: true,
						remaining: BOT_OPERATION_RATE_LIMIT.limit,
						resetAfterMs: BOT_OPERATION_RATE_LIMIT.windowMs,
						limit: BOT_OPERATION_RATE_LIMIT.limit,
					}
				}),
			),
		)

	if (!result.allowed) {
		return yield* Effect.fail(
			new RateLimitExceededError({
				message: "Bot operation rate limit exceeded. Please wait before trying again.",
				retryAfterMs: result.resetAfterMs,
				limit: result.limit,
				remaining: 0,
			}),
		)
	}

	yield* Effect.logDebug(
		`Bot operation rate limit check passed for user ${userId}: ${result.remaining}/${result.limit} remaining`,
	)
})

/**
 * Check rate limit for bot update operations.
 * Call this at the start of bot update handlers.
 *
 * @param userId - The user ID to rate limit
 */
export const checkBotUpdateRateLimit = Effect.fn("RateLimitHelpers.checkBotUpdateRateLimit")(function* (
	userId: string,
) {
	const rateLimiter = yield* RateLimiter

	const result = yield* rateLimiter
		.consume(`bot-updates:${userId}`, BOT_UPDATE_RATE_LIMIT.limit, BOT_UPDATE_RATE_LIMIT.windowMs)
		.pipe(
			Effect.catchTag("RateLimiterError", (error) =>
				Effect.gen(function* () {
					// Log the error but allow the request through (fail open)
					yield* Effect.logWarning("Rate limiter unavailable, allowing request", error)
					return {
						allowed: true,
						remaining: BOT_UPDATE_RATE_LIMIT.limit,
						resetAfterMs: BOT_UPDATE_RATE_LIMIT.windowMs,
						limit: BOT_UPDATE_RATE_LIMIT.limit,
					}
				}),
			),
		)

	if (!result.allowed) {
		return yield* Effect.fail(
			new RateLimitExceededError({
				message: "Bot update rate limit exceeded. Please wait before trying again.",
				retryAfterMs: result.resetAfterMs,
				limit: result.limit,
				remaining: 0,
			}),
		)
	}

	yield* Effect.logDebug(
		`Bot update rate limit check passed for user ${userId}: ${result.remaining}/${result.limit} remaining`,
	)
})
