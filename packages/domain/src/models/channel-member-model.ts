import { ChannelId, ChannelMemberId, MessageId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

/** What a member is notified of in a channel; null is the channel type's default. */
export const NotificationLevel = S.Literals(["all", "mentions", "nothing"])
export type NotificationLevel = typeof NotificationLevel.Type

class Model extends M.Class<Model>("ChannelMember")({
	id: M.Generated(ChannelMemberId),
	channelId: M.Immutable(ChannelId),
	userId: M.Immutable(UserId),
	isHidden: S.Boolean,
	isMuted: S.Boolean,
	/** Muted until then; `isMuted` is muted indefinitely. */
	mutedUntil: M.Defaulted(S.NullOr(JsonDate)),
	notificationLevel: M.Defaulted(S.NullOr(NotificationLevel)),
	isFavorite: S.Boolean,
	lastSeenMessageId: S.NullOr(MessageId),
	notificationCount: M.GeneratedByApp(S.Number),
	joinedAt: M.Immutable(JsonDate),
	createdAt: M.Generated(JsonDate),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
