import { ChannelId, ConnectConversationChannelId, ConnectConversationId, OrganizationId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const ConnectConversationChannelRole = S.Literals(["host", "guest"])
export type ConnectConversationChannelRole = S.Schema.Type<typeof ConnectConversationChannelRole>

class Model extends M.Class<Model>("ConnectConversationChannel")({
	id: M.Generated(ConnectConversationChannelId),
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	channelId: ChannelId,
	role: ConnectConversationChannelRole,
	allowGuestMemberAdds: S.Boolean,
	isActive: S.Boolean,
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
