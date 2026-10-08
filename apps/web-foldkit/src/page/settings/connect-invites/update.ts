import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { failureToast, settle, successToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import { embedInteraction } from "../integrations/shared/interaction"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

/** The interaction targets of one invite's Decline and Accept buttons. */
export const declineTarget = (inviteId: ConnectInviteId) => `decline-${inviteId}`
export const acceptTarget = (inviteId: ConnectInviteId) => `accept-${inviteId}`

/** Both buttons of the row disable while either action runs, which ends their hover. */
const busy = (model: Model, inviteId: ConnectInviteId) =>
	modifyFields(model, {
		interaction: (state) =>
			Interaction.disabledTargets(state, [declineTarget(inviteId), acceptTarget(inviteId)]),
	})

const inviteNotFound = (description: string) => ({
	ConnectInviteNotFoundError: { title: "Invite not found", description },
})

// COMMAND

export const ListIncomingInvites = Command.define("ListIncomingInvites", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListInvites, Message.FailedListInvites],
	execute: ({ organizationId }) =>
		settle(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("connectShare.invite.listIncoming", { organizationId })
			}),
			(response) =>
				Message.SucceededListInvites({
					invites: response.data.map((invite) => ({
						id: invite.id,
						hostOrganizationId: invite.hostOrganizationId,
						status: invite.status,
						createdAtMs: toDate(invite.createdAt).getTime(),
					})),
				}),
			() => Message.FailedListInvites(),
		),
})

export const AcceptInvite = Command.define("AcceptInvite", {
	args: { inviteId: ConnectInviteId, guestOrganizationId: OrganizationId },
	messages: [Message.SucceededAccept, Message.FailedAccept],
	execute: ({ inviteId, guestOrganizationId }) =>
		settle(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("connectShare.invite.accept", { inviteId, guestOrganizationId })
			}),
			() => Message.SucceededAccept({ inviteId }),
			(cause) =>
				Message.FailedAccept({
					inviteId,
					toast: failureToast(cause, {
						...inviteNotFound("This invite may have been revoked or expired."),
						ConnectInviteInvalidStateError: {
							title: "Cannot accept",
							description: "This invite is no longer in an acceptable state.",
						},
						ConnectWorkspaceNotFoundError: {
							title: "Workspace not found",
							description: "The target workspace could not be found.",
						},
						ConnectChannelAlreadySharedError: {
							title: "Already shared",
							description: "This channel is already shared with that organization.",
						},
					}),
				}),
		),
})

export const DeclineInvite = Command.define("DeclineInvite", {
	args: { inviteId: ConnectInviteId },
	messages: [Message.SucceededDecline, Message.FailedDecline],
	execute: ({ inviteId }) =>
		settle(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("connectShare.invite.decline", { inviteId })
			}),
			() => Message.SucceededDecline({ inviteId }),
			(cause) =>
				Message.FailedDecline({
					inviteId,
					toast: failureToast(cause, {
						...inviteNotFound("This invite may have already been revoked or expired."),
						ConnectInviteInvalidStateError: {
							title: "Cannot decline",
							description: "This invite is no longer in a declinable state.",
						},
						ConnectWorkspaceNotFoundError: {
							title: "Workspace not found",
							description: "This invite is not bound to a workspace.",
						},
					}),
				}),
		),
})

// INIT

/** Requests the list once the organization is known, and again when it changes. */
const requestFor = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedFor) return { model }
	return {
		model: modifyFields(model, { requestedFor: () => organizationId, invites: () => [] }),
		commands: [ListIncomingInvites({ organizationId })],
	}
}

export const init = (_route: unknown, shared: Shared): Return =>
	requestFor(
		{
			requestedFor: null,
			invites: [],
			hostOrganizations: [],
			acceptingIds: [],
			decliningIds: [],
			interaction: Interaction.init(),
		},
		shared,
	)

export const sharedChanged = requestFor

// UPDATE

const without = (ids: ReadonlyArray<ConnectInviteId>, id: ConnectInviteId) =>
	ids.filter((other) => other !== id)

/** Legacy invalidates the `connectInvites:incoming:<org>` reactivity key after a successful mutation. */
const refetch = (model: Model): ReadonlyArray<Command.Command<Message, never, HazelRpc>> =>
	model.requestedFor === null ? [] : [ListIncomingInvites({ organizationId: model.requestedFor })]

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListInvites: ({ invites }) => ({ model: modifyFields(model, { invites: () => invites }) }),
		FailedListInvites: () => ({ model: modifyFields(model, { invites: () => [] }) }),
		UpdatedHostOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { hostOrganizations: () => organizations }),
		}),
		ClickedAccept: ({ inviteId }) =>
			shared.organization === null
				? { model }
				: {
						model: modifyFields(busy(model, inviteId), {
							acceptingIds: (ids) => [...ids, inviteId],
						}),
						commands: [AcceptInvite({ inviteId, guestOrganizationId: shared.organization.id })],
					},
		SucceededAccept: ({ inviteId }) => ({
			model: modifyFields(model, { acceptingIds: (ids) => without(ids, inviteId) }),
			commands: refetch(model),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Channel connected") }),
		}),
		FailedAccept: ({ inviteId, toast }) => ({
			model: modifyFields(model, { acceptingIds: (ids) => without(ids, inviteId) }),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
		ClickedDecline: ({ inviteId }) => ({
			model: modifyFields(busy(model, inviteId), { decliningIds: (ids) => [...ids, inviteId] }),
			commands: [DeclineInvite({ inviteId })],
		}),
		SucceededDecline: ({ inviteId }) => ({
			model: modifyFields(model, { decliningIds: (ids) => without(ids, inviteId) }),
			commands: refetch(model),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite declined") }),
		}),
		FailedDecline: ({ inviteId, toast }) => ({
			model: modifyFields(model, { decliningIds: (ids) => without(ids, inviteId) }),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})
