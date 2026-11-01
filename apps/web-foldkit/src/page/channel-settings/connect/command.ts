import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { toDate } from "~/lib/utils"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import { type Invite, Message } from "./model"

/** `listOutgoingInvitesQuery`, filtered to the invites this channel hosts. */
export const ListOutgoingInvites = Command.define("ListOutgoingInvites", {
	args: { organizationId: OrganizationId, channelId: ChannelId },
	messages: [Message.SucceededListOutgoingInvites, Message.FailedListOutgoingInvites],
	execute: ({ organizationId, channelId }) =>
		HazelRpc.use((rpc) => rpc("connectShare.invite.listOutgoing", { organizationId })).pipe(
			Effect.map((response) =>
				Message.SucceededListOutgoingInvites({
					organizationId,
					invites: response.data
						.filter((invite) => invite.hostChannelId === channelId)
						.map((invite): Invite => ({
							id: invite.id,
							targetValue: invite.targetValue,
							status: invite.status,
							createdAtMs: toDate(invite.createdAt).getTime(),
						})),
				}),
			),
			catchCommon((reason) => Message.FailedListOutgoingInvites({ organizationId, reason })),
		),
})

export const RevokeInvite = Command.define("RevokeInvite", {
	args: { inviteId: ConnectInviteId },
	messages: [Message.SucceededRevokeInvite, Message.FailedRevokeInvite],
	execute: ({ inviteId }) =>
		HazelRpc.use((rpc) => rpc("connectShare.invite.revoke", { inviteId })).pipe(
			Effect.as(Message.SucceededRevokeInvite({ inviteId })),
			Effect.catchTags({
				ConnectInviteNotFoundError: () =>
					Effect.succeed(Message.FailedRevokeInvite({ inviteId, reason: "NotFound" })),
				ConnectInviteInvalidStateError: () =>
					Effect.succeed(Message.FailedRevokeInvite({ inviteId, reason: "NotRevokable" })),
			}),
			catchCommon((reason) => Message.FailedRevokeInvite({ inviteId, reason })),
		),
})

export const DisconnectOrganization = Command.define("DisconnectOrganization", {
	args: {
		mountId: Schema.String,
		conversationId: ConnectConversationId,
		organizationId: OrganizationId,
		isLeaving: Schema.Boolean,
	},
	messages: [Message.SucceededDisconnect, Message.FailedDisconnect],
	execute: ({ mountId, conversationId, organizationId, isLeaving }) =>
		HazelRpc.use((rpc) =>
			rpc("connectShare.organization.disconnect", { conversationId, organizationId }),
		).pipe(
			Effect.as(
				Message.SucceededDisconnect({
					mountId,
					successMessage: isLeaving ? "Left shared channel" : "Organization disconnected",
				}),
			),
			Effect.catchTags({
				ConnectConversationNotFoundError: () =>
					Effect.succeed(Message.FailedDisconnect({ mountId, reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedDisconnect({ mountId, reason })),
		),
})
