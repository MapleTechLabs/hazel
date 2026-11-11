import { ChannelId, ConnectConversationId, ConnectParticipantId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("ConnectParticipant")({
	id: M.Generated(ConnectParticipantId),
	conversationId: ConnectConversationId,
	channelId: ChannelId,
	userId: UserId,
	homeOrganizationId: OrganizationId,
	isExternal: S.Boolean,
	addedBy: S.NullOr(UserId),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
