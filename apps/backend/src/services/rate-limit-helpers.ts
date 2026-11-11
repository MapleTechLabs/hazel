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

interface RateLimitCheck {
	/** The span and log name: `RateLimitHelpers.<name>`. */
	readonly name: string
	/** What is being limited, as the logs say it ("Message", "Avatar"). */
	readonly label: string
	readonly keyPrefix: string
	readonly config: { readonly limit: number; readonly windowMs: number }
	/** What the caller is told when the limit is hit. */
	readonly message: string
}

/**
 * A per-user rate limit check, to call at the start of a handler. It fails open: when the limiter
 * cannot be reached the request goes through.
 */
const makeRateLimitCheck = ({ name, label, keyPrefix, config, message }: RateLimitCheck) =>
	Effect.fn(`RateLimitHelpers.${name}`)(function* (userId: string) {
		const rateLimiter = yield* RateLimiter

		const result = yield* rateLimiter.consume(`${keyPrefix}${userId}`, config.limit, config.windowMs).pipe(
			Effect.catchTag("RateLimiterError", (error) =>
				Effect.gen(function* () {
					yield* Effect.logWarning("Rate limiter unavailable, allowing request", error)
					return {
						allowed: true,
						remaining: config.limit,
						resetAfterMs: config.windowMs,
						limit: config.limit,
					}
				}),
			),
		)

		if (!result.allowed) {
			return yield* Effect.fail(
				new RateLimitExceededError({
					message,
					// At most this: the message binding does not say when the window ends.
					retryAfterMs: result.resetAfterMs,
					limit: result.limit,
					remaining: 0,
				}),
			)
		}

		yield* Effect.logDebug(
			`${label} rate limit check passed for user ${userId}: ${result.remaining}/${result.limit} remaining`,
		)
	})

export const checkMessageRateLimit = makeRateLimitCheck({
	name: "checkMessageRateLimit",
	label: "Message",
	keyPrefix: MESSAGE_RATE_LIMIT_KEY_PREFIX,
	config: MESSAGE_RATE_LIMIT,
	message: "Message rate limit exceeded. Please wait before sending more messages.",
})

export const checkAvatarRateLimit = makeRateLimitCheck({
	name: "checkAvatarRateLimit",
	label: "Avatar",
	keyPrefix: "avatars:",
	config: AVATAR_RATE_LIMIT,
	message: "Avatar upload rate limit exceeded. Please wait before uploading again.",
})

/** Create, install, uninstall and regenerateToken. */
export const checkBotOperationRateLimit = makeRateLimitCheck({
	name: "checkBotOperationRateLimit",
	label: "Bot operation",
	keyPrefix: "bot-operations:",
	config: BOT_OPERATION_RATE_LIMIT,
	message: "Bot operation rate limit exceeded. Please wait before trying again.",
})

export const checkBotUpdateRateLimit = makeRateLimitCheck({
	name: "checkBotUpdateRateLimit",
	label: "Bot update",
	keyPrefix: "bot-updates:",
	config: BOT_UPDATE_RATE_LIMIT,
	message: "Bot update rate limit exceeded. Please wait before trying again.",
})
