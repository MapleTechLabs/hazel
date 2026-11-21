/** Errors of `channel.generateName` (thread naming, `apps/backend/src/services/thread-namer.ts`). */
import { ChannelId, MessageId } from "@hazel/schema"
import { Schema } from "effect"

// ============================================================================
// Typed Error Types - Resource Errors
// ============================================================================

/** Thread channel does not exist */
export class ThreadChannelNotFoundError extends Schema.TaggedError<
	ThreadChannelNotFoundError,
	{ readonly brand: unique symbol }
>()("ThreadChannelNotFoundError", { threadChannelId: ChannelId }) {
	readonly retryable = false // Resource not found won't change on retry
}

/** Original message that started the thread was not found */
export class OriginalMessageNotFoundError extends Schema.TaggedError<
	OriginalMessageNotFoundError,
	{ readonly brand: unique symbol }
>()("OriginalMessageNotFoundError", { threadChannelId: ChannelId, messageId: MessageId }) {
	readonly retryable = false // Resource not found won't change on retry
}

/** Database query failed during context gathering */
export class ThreadContextQueryError extends Schema.TaggedError<
	ThreadContextQueryError,
	{ readonly brand: unique symbol }
>()("ThreadContextQueryError", {
	threadChannelId: ChannelId,
	operation: Schema.Literals(["thread", "originalMessage", "threadMessages"]),
	cause: Schema.Unknown.pipe(Schema.optional),
}) {
	readonly retryable = true // Database errors are transient
}

// ============================================================================
// Typed Error Types - AI Errors
// ============================================================================

/** AI provider is unreachable or returned an error */
export class AIProviderUnavailableError extends Schema.TaggedError<
	AIProviderUnavailableError,
	{ readonly brand: unique symbol }
>()("AIProviderUnavailableError", { provider: Schema.String, cause: Schema.Unknown.pipe(Schema.optional) }) {
	readonly retryable = true // External service may recover
}

/** AI provider rate limited the request */
export class AIRateLimitError extends Schema.TaggedError<
	AIRateLimitError,
	{ readonly brand: unique symbol }
>()("AIRateLimitError", {
	provider: Schema.String,
	retryAfter: Schema.Finite.pipe(Schema.optional),
}) {
	readonly retryable = true // Will succeed after delay
}

/** AI response could not be parsed or was empty */
export class AIResponseParseError extends Schema.TaggedError<
	AIResponseParseError,
	{ readonly brand: unique symbol }
>()("AIResponseParseError", {
	threadChannelId: ChannelId,
	rawResponse: Schema.String.pipe(Schema.optional),
}) {
	readonly retryable = false // Bad data won't fix itself
}

// ============================================================================
// Typed Error Types - Update Errors
// ============================================================================

/** Database update for thread name failed */
export class ThreadNameUpdateError extends Schema.TaggedError<
	ThreadNameUpdateError,
	{ readonly brand: unique symbol }
>()("ThreadNameUpdateError", {
	threadChannelId: ChannelId,
	newName: Schema.String,
	cause: Schema.Unknown.pipe(Schema.optional),
}) {
	readonly retryable = true // Database errors are transient
}

// ============================================================================
// Union of all thread naming errors (for RPC exposure)
// ============================================================================

export const ThreadNamingWorkflowError = Schema.Union([
	ThreadChannelNotFoundError,
	OriginalMessageNotFoundError,
	ThreadContextQueryError,
	AIProviderUnavailableError,
	AIRateLimitError,
	AIResponseParseError,
	ThreadNameUpdateError,
])

export type ThreadNamingWorkflowError = typeof ThreadNamingWorkflowError.Type
