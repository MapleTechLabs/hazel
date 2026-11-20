import { ChannelId, UserId, UserPresenceStatusId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const UserPresenceStatusEnum = S.Literals(["online", "away", "busy", "dnd", "offline"])
export type UserPresenceStatusEnum = S.Schema.Type<typeof UserPresenceStatusEnum>

/** One kind of device's status (`desktopStatus` / `webStatus` / `mobileStatus`). */
export const ClientPresenceStatus = S.Literals(["online", "away", "dnd"])
export type ClientPresenceStatus = S.Schema.Type<typeof ClientPresenceStatus>

/** The statuses a user can pick (Discord's Online, Idle, Do Not Disturb, Invisible). */
export const PreferredPresenceStatus = S.Literals(["online", "idle", "dnd", "invisible"])
export type PreferredPresenceStatus = S.Schema.Type<typeof PreferredPresenceStatus>

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
	desktopStatus: M.GeneratedByApp(S.NullOr(ClientPresenceStatus)),
	webStatus: M.GeneratedByApp(S.NullOr(ClientPresenceStatus)),
	mobileStatus: M.GeneratedByApp(S.NullOr(ClientPresenceStatus)),
	afk: M.GeneratedByApp(S.Boolean),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
