import { Schema } from "effect"

/**
 * Error thrown when a user exceeds their rate limit.
 * Contains information about when they can retry.
 */
export class RateLimitExceededError extends Schema.TaggedError<
	RateLimitExceededError,
	{ readonly brand: unique symbol }
>()(
	"RateLimitExceededError",
	{
		message: Schema.String,
		retryAfterMs: Schema.Finite,
		limit: Schema.Finite,
		remaining: Schema.Finite,
	},
	{ httpApiStatus: 429 },
) {}
