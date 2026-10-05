import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { InternalServerError, MessageNotFoundError, UnauthorizedError } from "../../errors"
import { AttachmentId, ChannelId, MessageId } from "@hazel/schema"
import { Message, MessageReaction } from "../../models"
import { MessageEmbeds } from "../../models/message-embed-schema"
import { RateLimitExceededError } from "../../rate-limit-errors"
import { RequiredScopes } from "../../scopes/required-scopes"
import { TransactionId } from "@hazel/schema"

// ============ PAGINATION SCHEMAS (Stripe-style) ============

export class ListMessagesQuery extends Schema.Class<ListMessagesQuery>("ListMessagesQuery")({
	channel_id: ChannelId,
	/** Cursor for older messages (fetch messages created before this message) */
	starting_after: Schema.optional(MessageId),
	/** Cursor for newer messages (fetch messages created after this message) */
	ending_before: Schema.optional(MessageId),
	/** Maximum number of messages to return (1-100, default 25) */
	limit: Schema.optional(
		Schema.NumberFromString.check(
			Schema.isInt(),
			Schema.isGreaterThanOrEqualTo(1),
			Schema.isLessThanOrEqualTo(100),
		),
	),
}) {}

export class ListMessagesResponse extends Schema.Class<ListMessagesResponse>("ListMessagesResponse")({
	data: Schema.Array(Message.Schema as any),
	has_more: Schema.Boolean,
}) {}

// ============ REQUEST SCHEMAS ============

export class CreateMessageRequest extends Schema.Class<CreateMessageRequest>("CreateMessageRequest")({
	channelId: ChannelId,
	content: Schema.String,
	replyToMessageId: Schema.NullishOr(MessageId),
	threadChannelId: Schema.NullishOr(ChannelId),
	attachmentIds: Schema.optional(Schema.Array(AttachmentId)),
	embeds: Schema.NullishOr(MessageEmbeds),
}) {}

export class UpdateMessageRequest extends Schema.Class<UpdateMessageRequest>("UpdateMessageRequest")({
	content: Schema.optional(Schema.String),
	embeds: Schema.optional(Schema.NullOr(MessageEmbeds)),
}) {}

export class ToggleReactionRequest extends Schema.Class<ToggleReactionRequest>("ToggleReactionRequest")({
	emoji: Schema.String,
	channelId: ChannelId,
}) {}

// ============ RESPONSE SCHEMAS ============

export class MessageResponse extends Schema.Class<MessageResponse>("MessageResponse")({
	data: Message.Schema as any,
	transactionId: TransactionId,
}) {}

export class DeleteMessageResponse extends Schema.Class<DeleteMessageResponse>("DeleteMessageResponse")({
	transactionId: TransactionId,
}) {}

export class ToggleReactionResponse extends Schema.Class<ToggleReactionResponse>("ToggleReactionResponse")({
	wasCreated: Schema.Boolean,
	data: Schema.optional(MessageReaction.Schema as any),
	transactionId: TransactionId,
}) {}

// ============ ERROR TYPES ============

export class ChannelNotFoundError extends Schema.TaggedError<ChannelNotFoundError>()(
	"ChannelNotFoundError",
	{
		channelId: ChannelId,
	},
	{ httpApiStatus: 404 },
) {}

export class InvalidPaginationError extends Schema.TaggedError<InvalidPaginationError>()(
	"InvalidPaginationError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {}

// ============ API GROUP ============

export class MessagesApiGroup extends HttpApiGroup.make("api-v1-messages")
	// List messages (with cursor-based pagination)
	.add(
		HttpApiEndpoint.get("listMessages", `/messages`, {
			query: ListMessagesQuery,
			success: ListMessagesResponse,
			error: [ChannelNotFoundError, UnauthorizedError, InvalidPaginationError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "List Messages",
					description:
						"List messages in a channel with Stripe-style cursor-based pagination. Returns messages in reverse chronological order (newest first).",
					summary: "List messages",
				}),
			)
			.annotate(RequiredScopes, ["messages:read"]),
	)
	// Create message
	.add(
		HttpApiEndpoint.post("createMessage", `/messages`, {
			payload: CreateMessageRequest,
			success: MessageResponse,
			error: [ChannelNotFoundError, UnauthorizedError, RateLimitExceededError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Create Message",
					description: "Create a new message in a channel",
					summary: "Create message",
				}),
			)
			.annotate(RequiredScopes, ["messages:write"]),
	)
	// Update message
	.add(
		HttpApiEndpoint.patch("updateMessage", `/messages/:id`, {
			params: { id: MessageId },
			payload: UpdateMessageRequest,
			success: MessageResponse,
			error: [MessageNotFoundError, UnauthorizedError, RateLimitExceededError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Update Message",
					description: "Update an existing message",
					summary: "Update message",
				}),
			)
			.annotate(RequiredScopes, ["messages:write"]),
	)
	// Delete message
	.add(
		HttpApiEndpoint.delete("deleteMessage", `/messages/:id`, {
			params: { id: MessageId },
			success: DeleteMessageResponse,
			error: [MessageNotFoundError, UnauthorizedError, RateLimitExceededError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Delete Message",
					description: "Delete a message",
					summary: "Delete message",
				}),
			)
			.annotate(RequiredScopes, ["messages:write"]),
	)
	// Toggle reaction
	.add(
		HttpApiEndpoint.post("toggleReaction", `/messages/:id/reactions`, {
			params: { id: MessageId },
			payload: ToggleReactionRequest,
			success: ToggleReactionResponse,
			error: [MessageNotFoundError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Toggle Reaction",
					description: "Toggle a reaction on a message",
					summary: "Toggle reaction",
				}),
			)
			.annotate(RequiredScopes, ["message-reactions:write"]),
	)
	.prefix("/api/v1") {}
