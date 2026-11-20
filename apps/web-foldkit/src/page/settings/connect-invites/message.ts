import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import * as Interaction from "../../../ui/aria/interaction"
import { AcceptFailure, DeclineFailure, HostOrganization, Invite } from "./model"

export const Message = defineMessageUnion({
	SucceededListInvites: {
		organizationId: OrganizationId,
		version: Schema.Finite,
		invites: Schema.Array(Invite),
	},
	FailedListInvites: { organizationId: OrganizationId, version: Schema.Finite, reason: CommonReason },
	ClickedRetryListInvites: {},
	UpdatedHostOrganizations: { organizations: Schema.Array(HostOrganization) },
	ClickedAccept: { inviteId: ConnectInviteId },
	/** The joined conversation and the write that created the org's channel for it. */
	SucceededAccept: {
		inviteId: ConnectInviteId,
		conversationId: ConnectConversationId,
		transactionId: Schema.String,
	},
	/** The org's channel for the joined conversation (null: not synced in time). */
	FoundJoinedChannel: { channelId: Schema.NullOr(ChannelId) },
	FailedAccept: { inviteId: ConnectInviteId, reason: AcceptFailure },
	ClickedDecline: { inviteId: ConnectInviteId },
	SucceededDecline: { inviteId: ConnectInviteId },
	FailedDecline: { inviteId: ConnectInviteId, reason: DeclineFailure },
	GotInteractionMessage: { message: Interaction.Message },
	GotSuggestionMessage: { message: SuggestionPrompt.Message },
})
export type Message = typeof Message.Type
