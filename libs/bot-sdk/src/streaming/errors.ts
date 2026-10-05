/**
 * Streaming errors for the bot SDK
 *
 * Following Effect best practices with specific tagged errors for each failure mode.
 * This enables type-safe error handling with catchTag/catchTags.
 */

import { Schema } from "effect"

/**
 * Error thrown when connecting to a message actor fails
 */
export class ActorConnectionError extends Schema.TaggedError<ActorConnectionError>()("ActorConnectionError", {
	messageId: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when creating a message with live state fails
 */
export class MessageCreateError extends Schema.TaggedError<MessageCreateError>()("MessageCreateError", {
	channelId: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when an actor operation (appendText, complete, etc.) fails
 */
export class ActorOperationError extends Schema.TaggedError<ActorOperationError>()("ActorOperationError", {
	operation: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when processing an async stream of chunks fails
 */
export class StreamProcessingError extends Schema.TaggedError<StreamProcessingError>()(
	"StreamProcessingError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

/**
 * Error thrown when bot runtime config is not available for streaming
 */
export class BotNotConfiguredError extends Schema.TaggedError<BotNotConfiguredError>()(
	"BotNotConfiguredError",
	{
		message: Schema.String,
	},
) {}

/**
 * Error thrown when persisting the final message state to the database fails.
 * This is a non-fatal error - the stream completed successfully, but the
 * final state wasn't saved to the database.
 */
export class MessagePersistError extends Schema.TaggedError<MessagePersistError>()("MessagePersistError", {
	messageId: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Union type for all streaming errors.
 * Use with Effect.catchTags for comprehensive error handling.
 *
 * @example
 * ```typescript
 * yield* stream.appendText("Hello").pipe(
 *   Effect.catchTags({
 *     ActorOperationError: (err) => Effect.log(`Actor op failed: ${err.operation}`),
 *     StreamProcessingError: (err) => Effect.log(`Stream failed: ${err.message}`),
 *   })
 * )
 * ```
 */
export type StreamingError =
	| ActorConnectionError
	| MessageCreateError
	| ActorOperationError
	| StreamProcessingError
	| BotNotConfiguredError
	| MessagePersistError
