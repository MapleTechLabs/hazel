import { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import { failureToast } from "../../../data/actions"
import { type Invite, Message } from "./model"

/** `listOutgoingInvitesQuery`, filtered to the invites this channel hosts. */
export const ListOutgoingInvites = Command.define("ListOutgoingInvites", {
	args: { organizationId: OrganizationId, channelId: ChannelId },
	messages: [Message.SucceededListOutgoingInvites, Message.FailedListOutgoingInvites],
	execute: ({ organizationId, channelId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const response = yield* client("connectShare.invite.listOutgoing", { organizationId })
			const invites = response.data
				.filter((invite) => invite.hostChannelId === channelId)
				.map(
					(invite): Invite => ({
						id: invite.id,
						targetValue: invite.targetValue,
						status: invite.status,
						createdAtMs: toDate(invite.createdAt).getTime(),
					}),
				)
			return Message.SucceededListOutgoingInvites({ organizationId, invites })
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedListOutgoingInvites()))),
})

export const RevokeInvite = Command.define("RevokeInvite", {
	args: { inviteId: ConnectInviteId },
	messages: [Message.SucceededRevokeInvite, Message.FailedRevokeInvite],
	execute: ({ inviteId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("connectShare.invite.revoke", { inviteId }))
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededRevokeInvite({ inviteId }),
				onFailure: (cause) => {
					const toast = failureToast(cause, "exitToast", {
						ConnectInviteNotFoundError: {
							title: "Invite not found",
							description: "This invite may have already been revoked or expired.",
							isRetryable: false,
						},
						ConnectInviteInvalidStateError: {
							title: "Cannot revoke",
							description: "This invite is no longer in a revokable state.",
							isRetryable: false,
						},
					})
					return Message.FailedRevokeInvite({
						inviteId,
						title: toast.title,
						description: toast.description,
					})
				},
			})
		}),
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
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client("connectShare.organization.disconnect", { conversationId, organizationId }),
			)
			return Exit.match(exit, {
				onSuccess: () =>
					Message.SucceededDisconnect({
						mountId,
						successMessage: isLeaving ? "Left shared channel" : "Organization disconnected",
					}),
				onFailure: (cause) => {
					const toast = failureToast(cause, "exitToast")
					return Message.FailedDisconnect({
						mountId,
						title: toast.title,
						description: toast.description,
					})
				},
			})
		}),
})
