import { ChannelId, MessageId, PinnedMessageId, UserId } from "@hazel/schema"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("PinnedMessage")({
	id: M.Generated(PinnedMessageId),
	channelId: M.Immutable(ChannelId),
	messageId: M.Immutable(MessageId),
	pinnedBy: M.Immutable(UserId),
	pinnedAt: M.Immutable(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
