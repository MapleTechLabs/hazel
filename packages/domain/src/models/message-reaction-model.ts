import { ChannelId, ConnectConversationId, MessageId, MessageReactionId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("MessageReaction")({
	id: M.Generated(MessageReactionId),
	messageId: M.Immutable(MessageId),
	channelId: M.Immutable(ChannelId),
	conversationId: M.GeneratedOptional(S.NullOr(ConnectConversationId)),
	userId: M.Immutable(UserId),
	emoji: S.String,
	createdAt: M.Generated(JsonDate),
}) {}

export const Insert = S.Struct({
	...M.structFields(Model.insert),
	conversationId: S.optional(S.NullOr(ConnectConversationId)),
})
export const { Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
