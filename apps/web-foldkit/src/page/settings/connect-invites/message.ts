import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../ui/aria/interaction"
import { AcceptFailure, DeclineFailure, HostOrganization, Invite } from "./model"

export const Message = defineMessageUnion({
	SucceededListInvites: {
		organizationId: OrganizationId,
		version: Schema.Number,
		invites: Schema.Array(Invite),
	},
	FailedListInvites: { organizationId: OrganizationId, version: Schema.Number, reason: CommonReason },
	ClickedRetryListInvites: {},
	UpdatedHostOrganizations: { organizations: Schema.Array(HostOrganization) },
	ClickedAccept: { inviteId: ConnectInviteId },
	SucceededAccept: { inviteId: ConnectInviteId },
	FailedAccept: { inviteId: ConnectInviteId, reason: AcceptFailure },
	ClickedDecline: { inviteId: ConnectInviteId },
	SucceededDecline: { inviteId: ConnectInviteId },
	FailedDecline: { inviteId: ConnectInviteId, reason: DeclineFailure },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
