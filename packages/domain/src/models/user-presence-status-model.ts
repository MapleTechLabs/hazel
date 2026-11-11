import { ChannelId, UserId, UserPresenceStatusId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const UserPresenceStatusEnum = S.Literals(["online", "away", "busy", "dnd", "offline"])
export type UserPresenceStatusEnum = S.Schema.Type<typeof UserPresenceStatusEnum>

class Model extends M.Class<Model>("UserPresenceStatus")({
	id: M.Generated(UserPresenceStatusId),
	userId: M.Immutable(UserId),
	status: UserPresenceStatusEnum,
	customMessage: S.NullOr(S.String),
	statusEmoji: S.NullOr(S.String),
	statusExpiresAt: S.NullOr(JsonDate),
	activeChannelId: M.GeneratedByApp(S.NullOr(ChannelId)),
	suppressNotifications: S.Boolean,
	updatedAt: M.GeneratedByApp(JsonDate),
	lastSeenAt: M.GeneratedByApp(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
