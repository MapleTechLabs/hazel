import { ChannelId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const ConnectConversationStatus = S.Literals(["active", "disconnected"])
export type ConnectConversationStatus = S.Schema.Type<typeof ConnectConversationStatus>

class Model extends M.Class<Model>("ConnectConversation")({
	id: M.Generated(ConnectConversationId),
	hostOrganizationId: M.Immutable(OrganizationId),
	hostChannelId: M.Immutable(ChannelId),
	status: M.GeneratedByApp(ConnectConversationStatus),
	settings: S.NullOr(S.Record(S.String, S.Unknown)),
	createdBy: M.Immutable(UserId),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
