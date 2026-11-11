import { AttachmentId, ChannelId, ConnectConversationId, MessageId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { v5 as uuidv5 } from "uuid"
import { MessageEmbeds } from "./message-embed-schema"
import * as M from "./utils"
import { baseFields } from "./utils"

class Model extends M.Class<Model>("Message")({
	id: M.Generated(MessageId),
	channelId: ChannelId,
	conversationId: M.GeneratedOptional(S.NullOr(ConnectConversationId)),
	authorId: M.Immutable(UserId),
	content: S.String,
	embeds: S.NullOr(MessageEmbeds),
	replyToMessageId: S.NullOr(MessageId),
	threadChannelId: S.NullOr(ChannelId),
	...baseFields,
}) {}

const CLIENT_MESSAGE_NAMESPACE = "34b1155c-bcb5-479a-a68d-9ca0ccf5053e"

/**
 * The id of a message sent with `clientNonce`. The client derives it for its optimistic row and the
 * server for the stored one, so the synced row replaces the optimistic row in place. Hashing in the
 * channel and author keeps a client from picking an id that already names another message.
 */
export const clientMessageId = (channelId: ChannelId, authorId: UserId, clientNonce: string): MessageId =>
	MessageId.make(uuidv5(`${channelId}:${authorId}:${clientNonce}`, CLIENT_MESSAGE_NAMESPACE))

// Custom insert schema that includes attachmentIds for linking
export const Insert = S.Struct({
	...M.structFields(Model.insert),
	// One fixed nonce would make every send answer with the first message.
	clientNonce: S.optional(S.NonEmptyString.check(S.isMaxLength(64))),
	conversationId: S.optional(S.NullOr(ConnectConversationId)),
	attachmentIds: S.optional(S.Array(AttachmentId)),
})

export const { Update, Schema } = M.expose(Model)

/**
 * Custom update schema for JSON API - only allows mutable fields.
 * Excludes immutable relationship fields (channelId, replyToMessageId, threadChannelId)
 * to prevent users from moving messages between channels or fabricating conversation context.
 */
const JsonUpdate = S.Struct({
	content: S.optionalKey(M.structFields(Model.jsonUpdate).content),
	embeds: S.optionalKey(M.structFields(Model.jsonUpdate).embeds),
})

export type Type = typeof Schema.Type

export const Create = S.Struct({
	...M.structFields(Model.jsonCreate),
	attachmentIds: S.optional(S.Array(AttachmentId)),
})

export const Patch = JsonUpdate
