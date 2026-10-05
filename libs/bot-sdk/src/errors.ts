import { Schema } from "effect"

/**
 * Error thrown when bot authentication fails.
 */
export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()("AuthenticationError", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when a command payload cannot be decoded.
 */
export class CommandArgsDecodeError extends Schema.TaggedError<CommandArgsDecodeError>()(
	"CommandArgsDecodeError",
	{
		message: Schema.String,
		commandName: Schema.String,
		cause: Schema.Unknown,
	},
) {}

/**
 * Error thrown when a command handler fails.
 */
export class CommandHandlerError extends Schema.TaggedError<CommandHandlerError>()("CommandHandlerError", {
	message: Schema.String,
	commandName: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when syncing slash commands with the backend fails.
 */
export class CommandSyncError extends Schema.TaggedError<CommandSyncError>()("CommandSyncError", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when syncing mentionable settings fails.
 */
export class MentionableSyncError extends Schema.TaggedError<MentionableSyncError>()("MentionableSyncError", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

export class GatewayReadError extends Schema.TaggedError<GatewayReadError>()("GatewayReadError", {
	message: Schema.String,
	cause: Schema.Unknown,
}) {}

export class GatewayDecodeError extends Schema.TaggedError<GatewayDecodeError>()("GatewayDecodeError", {
	message: Schema.String,
	payload: Schema.String,
	cause: Schema.Unknown,
}) {}

export class GatewaySessionStoreError extends Schema.TaggedError<GatewaySessionStoreError>()(
	"GatewaySessionStoreError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

/**
 * Error thrown when sending a message fails.
 */
export class MessageSendError extends Schema.TaggedError<MessageSendError>()("MessageSendError", {
	message: Schema.String,
	channelId: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when replying to a message fails.
 */
export class MessageReplyError extends Schema.TaggedError<MessageReplyError>()("MessageReplyError", {
	message: Schema.String,
	channelId: Schema.String,
	replyToMessageId: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when updating a message fails.
 */
export class MessageUpdateError extends Schema.TaggedError<MessageUpdateError>()("MessageUpdateError", {
	message: Schema.String,
	messageId: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when deleting a message fails.
 */
export class MessageDeleteError extends Schema.TaggedError<MessageDeleteError>()("MessageDeleteError", {
	message: Schema.String,
	messageId: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when toggling a reaction fails.
 */
export class MessageReactError extends Schema.TaggedError<MessageReactError>()("MessageReactError", {
	message: Schema.String,
	messageId: Schema.String,
	emoji: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when listing messages fails.
 */
export class MessageListError extends Schema.TaggedError<MessageListError>()("MessageListError", {
	message: Schema.String,
	channelId: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Error thrown when an event handler execution fails.
 */
export class EventHandlerError extends Schema.TaggedError<EventHandlerError>()("EventHandlerError", {
	message: Schema.String,
	eventType: Schema.String,
	cause: Schema.Unknown,
}) {}

/**
 * Retry policy classification for tagged SDK errors.
 */
export type RetryPolicyClass = "none" | "quick" | "transient" | "connection"

/**
 * Get a retry policy class for a specific tagged error.
 */
export const retryPolicyForTag = (tag: string): RetryPolicyClass => {
	switch (tag) {
		case "AuthenticationError":
			return "connection"
		case "CommandSyncError":
		case "MentionableSyncError":
		case "GatewayReadError":
		case "GatewaySessionStoreError":
		case "MessageSendError":
		case "MessageReplyError":
		case "MessageUpdateError":
		case "MessageDeleteError":
		case "MessageReactError":
		case "MessageListError":
			return "transient"
		case "GatewayDecodeError":
			return "none"
		default:
			return "none"
	}
}

/**
 * Extract `_tag` from unknown Effect error values.
 */
export const getErrorTag = (error: unknown): string | null => {
	if (typeof error === "object" && error !== null && "_tag" in error) {
		const tag = (error as Record<string, unknown>)["_tag"]
		return typeof tag === "string" ? tag : null
	}
	return null
}

/**
 * Check if an unknown error should be retried based on its tag.
 */
export const isRetryableError = (error: unknown): boolean => {
	const tag = getErrorTag(error)
	if (!tag) {
		return false
	}
	return retryPolicyForTag(tag) !== "none"
}
