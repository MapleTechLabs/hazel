import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../overlay/toasts"
import * as Interaction from "../../../ui/aria/interaction"
import * as ShareModal from "./share-modal"

export const Mount = Schema.Struct({
	id: Schema.String,
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	role: Schema.Literals(["host", "guest"]),
})
export type Mount = typeof Mount.Type

export const OrgSummary = Schema.Struct({
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type OrgSummary = typeof OrgSummary.Type

export const Invite = Schema.Struct({
	id: ConnectInviteId,
	targetValue: Schema.String,
	status: Schema.String,
	createdAtMs: Schema.Number,
})
export type Invite = typeof Invite.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	channelName: Schema.NullOr(Schema.String),
	/** `getSharedConversationMountsForChannel`: every active mount of the channel's shared conversation. */
	mounts: Schema.Array(Mount),
	orgs: Schema.Record(Schema.String, OrgSummary),
	requestedOrganizationId: Schema.NullOr(OrganizationId),
	/** Outgoing invites hosted by this channel; empty until the query succeeds. */
	invites: Schema.Array(Invite),
	revokingInviteIds: Schema.Array(ConnectInviteId),
	disconnectingMountIds: Schema.Array(Schema.String),
	share: ShareModal.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	UpdatedChannelName: { name: Schema.NullOr(Schema.String) },
	UpdatedMounts: { mounts: Schema.Array(Mount) },
	UpdatedOrgs: { orgs: Schema.Record(Schema.String, OrgSummary) },
	SucceededListOutgoingInvites: { organizationId: OrganizationId, invites: Schema.Array(Invite) },
	FailedListOutgoingInvites: {},
	ClickedShareChannel: {},
	ClickedRevokeInvite: { inviteId: ConnectInviteId },
	GotInteractionMessage: { message: Interaction.Message },
	SucceededRevokeInvite: { inviteId: ConnectInviteId },
	FailedRevokeInvite: { inviteId: ConnectInviteId, toast: ToastRequest },
	ClickedDisconnect: { mountId: Schema.String },
	SucceededDisconnect: { mountId: Schema.String, successMessage: Schema.String },
	FailedDisconnect: { mountId: Schema.String, toast: ToastRequest },
	GotShareModalMessage: { message: ShareModal.Message },
})
export type Message = typeof Message.Type

/** `ConnectionRow`'s roles: who may disconnect whom. */
export const rowRoles = (
	mount: Mount,
	viewerRole: Mount["role"] | undefined,
	currentOrgId: OrganizationId | null,
) => {
	const isGuestLeavingConversation = viewerRole === "guest" && mount.role === "host"
	return {
		isOwnOrg: mount.organizationId === currentOrgId,
		isGuestLeavingConversation,
		canDisconnect: viewerRole === "host" || isGuestLeavingConversation,
		targetOrganizationId: isGuestLeavingConversation ? currentOrgId : mount.organizationId,
	}
}
