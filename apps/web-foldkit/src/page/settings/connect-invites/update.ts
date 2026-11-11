import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Result, Schema } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { toDate } from "~/lib/utils"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { type AcceptFailure, type DeclineFailure, type Invite, Invites, type Model } from "./model"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
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

/** The invites on screen: the loaded list, kept while a refetch runs or after one failed. */
export const invitesOf = (model: Model): ReadonlyArray<Invite> =>
	Option.getOrElse(AsyncData.getData(model.invites), () => [])

// COMMAND

export const ListIncomingInvites = Command.define("ListIncomingInvites", {
	args: { organizationId: OrganizationId, version: Schema.Number },
	messages: [Message.SucceededListInvites, Message.FailedListInvites],
	execute: ({ organizationId, version }) =>
		HazelRpc.use((client) => client("connectShare.invite.listIncoming", { organizationId })).pipe(
			Effect.map((response) =>
				Message.SucceededListInvites({
					organizationId,
					version,
					invites: response.data.map((invite) => ({
						id: invite.id,
						hostOrganizationId: invite.hostOrganizationId,
						status: invite.status,
						createdAtMs: toDate(invite.createdAt).getTime(),
					})),
				}),
			),
			catchCommon((reason) => Message.FailedListInvites({ organizationId, version, reason })),
		),
})

export const AcceptInvite = Command.define("AcceptInvite", {
	args: { inviteId: ConnectInviteId, guestOrganizationId: OrganizationId },
	messages: [Message.SucceededAccept, Message.FailedAccept],
	execute: ({ inviteId, guestOrganizationId }) => {
		const failed = (reason: AcceptFailure) => Effect.succeed(Message.FailedAccept({ inviteId, reason }))
		return HazelRpc.use((client) =>
			client("connectShare.invite.accept", { inviteId, guestOrganizationId }),
		).pipe(
			Effect.as(Message.SucceededAccept({ inviteId })),
			Effect.catchTags({
				ConnectInviteNotFoundError: () => failed("NotFound"),
				ConnectInviteInvalidStateError: () => failed("InvalidState"),
				ConnectWorkspaceNotFoundError: () => failed("WorkspaceNotFound"),
				ConnectChannelAlreadySharedError: () => failed("AlreadyShared"),
				ChannelNotFoundError: () => failed("ChannelNotFound"),
				// The invite's shared conversation is gone: the invite is as good as revoked.
				ConnectConversationNotFoundError: () => failed("NotFound"),
			}),
			catchCommon((reason) => Message.FailedAccept({ inviteId, reason })),
		)
	},
})

export const DeclineInvite = Command.define("DeclineInvite", {
	args: { inviteId: ConnectInviteId },
	messages: [Message.SucceededDecline, Message.FailedDecline],
	execute: ({ inviteId }) => {
		const failed = (reason: DeclineFailure) => Effect.succeed(Message.FailedDecline({ inviteId, reason }))
		return HazelRpc.use((client) => client("connectShare.invite.decline", { inviteId })).pipe(
			Effect.as(Message.SucceededDecline({ inviteId })),
			Effect.catchTags({
				ConnectInviteNotFoundError: () => failed("NotFound"),
				ConnectInviteInvalidStateError: () => failed("InvalidState"),
				ConnectWorkspaceNotFoundError: () => failed("WorkspaceNotFound"),
			}),
			catchCommon((reason) => Message.FailedDecline({ inviteId, reason })),
		)
	},
})

// INIT

/** Requests the list once the organization is known, and again when it changes. */
const requestFor = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedFor) return { model }
	const version = model.listVersion + 1
	return {
		model: modifyFields(model, {
			requestedFor: () => organizationId,
			listVersion: () => version,
			// Another organization's invites are not this one's stale data.
			invites: () => Invites.Loading(),
		}),
		commands: [ListIncomingInvites({ organizationId, version })],
	}
}

export const init = (_route: unknown, shared: Shared): Return =>
	requestFor(
		{
			requestedFor: null,
			listVersion: 0,
			invites: Invites.Idle(),
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

/**
 * Lists again under a new version, keeping loaded rows on screen. Legacy invalidates the
 * `connectInvites:incoming:<org>` reactivity key after a successful mutation.
 */
const refetch = (model: Model): Return => {
	if (model.requestedFor === null) return { model }
	const version = model.listVersion + 1
	return {
		model: modifyFields(model, {
			listVersion: () => version,
			invites: (invites) => Option.getOrElse(AsyncData.revalidateOrLoad(invites), () => invites),
		}),
		commands: [ListIncomingInvites({ organizationId: model.requestedFor, version })],
	}
}

/** Only the response to the latest request for the current organization lands. */
const isCurrentList = (model: Model, organizationId: OrganizationId, version: number) =>
	organizationId === model.requestedFor && version === model.listVersion

/** Either action on the row is already running. */
const isBusy = (model: Model, inviteId: ConnectInviteId) =>
	model.acceptingIds.includes(inviteId) || model.decliningIds.includes(inviteId)

const notFound = (description: string) => ({ title: "Invite not found", description })
const workspaceNotFound = (description: string) => ({ title: "Workspace not found", description })

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListInvites: ({ organizationId, version, invites }) =>
			isCurrentList(model, organizationId, version)
				? { model: modifyFields(model, { invites: () => Invites.Success({ data: invites }) }) }
				: { model },
		// A failed refetch keeps the rows it had (`Stale`); a failed first load shows the error.
		FailedListInvites: ({ organizationId, version, reason }) =>
			isCurrentList(model, organizationId, version)
				? {
						model: modifyFields(model, {
							invites: (invites) => AsyncData.settle(invites, Result.fail(reason)),
						}),
					}
				: { model },
		ClickedRetryListInvites: () => refetch(model),
		UpdatedHostOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { hostOrganizations: () => organizations }),
		}),
		ClickedAccept: ({ inviteId }) =>
			shared.organization === null || isBusy(model, inviteId)
				? { model }
				: {
						model: modifyFields(busy(model, inviteId), {
							acceptingIds: (ids) => [...ids, inviteId],
						}),
						commands: [AcceptInvite({ inviteId, guestOrganizationId: shared.organization.id })],
					},
		SucceededAccept: ({ inviteId }) => ({
			...refetch(modifyFields(model, { acceptingIds: (ids) => without(ids, inviteId) })),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Channel connected") }),
		}),
		FailedAccept: ({ inviteId, reason }) => ({
			model: modifyFields(model, { acceptingIds: (ids) => without(ids, inviteId) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: notFound("This invite may have been revoked or expired."),
						InvalidState: {
							title: "Cannot accept",
							description: "This invite is no longer in an acceptable state.",
						},
						WorkspaceNotFound: workspaceNotFound("The target workspace could not be found."),
						AlreadyShared: {
							title: "Already shared",
							description: "This channel is already shared with that organization.",
						},
						ChannelNotFound: {
							title: "Channel not found",
							description: "The shared channel may have been deleted.",
						},
					}),
				),
			}),
		}),
		ClickedDecline: ({ inviteId }) =>
			isBusy(model, inviteId)
				? { model }
				: {
						model: modifyFields(busy(model, inviteId), {
							decliningIds: (ids) => [...ids, inviteId],
						}),
						commands: [DeclineInvite({ inviteId })],
					},
		SucceededDecline: ({ inviteId }) => ({
			...refetch(modifyFields(model, { decliningIds: (ids) => without(ids, inviteId) })),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite declined") }),
		}),
		FailedDecline: ({ inviteId, reason }) => ({
			model: modifyFields(model, { decliningIds: (ids) => without(ids, inviteId) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: notFound("This invite may have already been revoked or expired."),
						InvalidState: {
							title: "Cannot decline",
							description: "This invite is no longer in a declinable state.",
						},
						WorkspaceNotFound: workspaceNotFound("This invite is not bound to a workspace."),
					}),
				),
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})
