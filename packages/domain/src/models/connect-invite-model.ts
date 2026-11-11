import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const ConnectInviteStatus = S.Literals(["pending", "accepted", "declined", "revoked", "expired"])
export type ConnectInviteStatus = S.Schema.Type<typeof ConnectInviteStatus>

export const ConnectInviteTargetKind = S.Literals(["slug", "email"])
export type ConnectInviteTargetKind = S.Schema.Type<typeof ConnectInviteTargetKind>

class Model extends M.Class<Model>("ConnectInvite")({
	id: M.Generated(ConnectInviteId),
	conversationId: ConnectConversationId,
	hostOrganizationId: OrganizationId,
	hostChannelId: ChannelId,
	targetKind: ConnectInviteTargetKind,
	targetValue: S.String,
	guestOrganizationId: S.NullOr(OrganizationId),
	status: ConnectInviteStatus,
	allowGuestMemberAdds: S.Boolean,
	invitedBy: UserId,
	acceptedBy: S.NullOr(UserId),
	acceptedAt: S.NullOr(JsonDate),
	expiresAt: S.NullOr(JsonDate),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
