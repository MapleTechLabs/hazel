import { Option } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, successToast } from "../../../data/actions"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { DisconnectOrganization, ListOutgoingInvites, RevokeInvite } from "./command"
import { Invites, Message, type Model, rowRoles } from "./model"
import * as ShareModal from "./share-modal"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

/** The interaction target of an invite's Revoke button. */
export const revokeTarget = (inviteId: string) => `revoke-${inviteId}`

const requestInvites = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedOrganizationId) return { model }
	return {
		model: modifyFields(model, {
			requestedOrganizationId: () => organizationId,
			invites: () => Invites.Loading(),
		}),
		commands: [ListOutgoingInvites({ organizationId, channelId: model.channelId })],
	}
}

export const init = (route: RouteOf<"ChannelSettingsConnect">, shared: Shared): Return =>
	requestInvites(
		{
			channelId: route.channelId,
			channelName: null,
			mounts: [],
			orgs: {},
			requestedOrganizationId: null,
			invites: Invites.Idle(),
			revokingInviteIds: [],
			disconnectingMountIds: [],
			share: ShareModal.init(),
			interaction: Interaction.init(),
		},
		shared,
	)

export const sharedChanged = (model: Model, shared: Shared): Return => requestInvites(model, shared)

/**
 * Refetches the list, keeping what it shows (`Refreshing`): after a write (the reactivity key
 * `connectInvites:outgoing:<org>`) and on retry. A load in flight may predate the write, so it refetches anyway.
 */
const reloadInvites = (model: Model): Return => {
	const organizationId = model.requestedOrganizationId
	if (organizationId === null) return { model }
	return {
		model: modifyFields(model, {
			invites: (invites) => Option.getOrElse(AsyncData.revalidateOrLoad(invites), () => invites),
		}),
		commands: [ListOutgoingInvites({ organizationId, channelId: model.channelId })],
	}
}

const without = <Id extends string>(ids: ReadonlyArray<Id>, id: Id): ReadonlyArray<Id> =>
	ids.filter((candidate) => candidate !== id)

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedChannelName: ({ name }) => ({ model: modifyFields(model, { channelName: () => name }) }),
		UpdatedMounts: ({ mounts }) => ({ model: modifyFields(model, { mounts: () => mounts }) }),
		UpdatedOrgs: ({ orgs }) => ({ model: modifyFields(model, { orgs: () => orgs }) }),
		SucceededListOutgoingInvites: ({ organizationId, invites }) =>
			organizationId === model.requestedOrganizationId
				? { model: modifyFields(model, { invites: () => Invites.Success({ data: invites }) }) }
				: { model },
		FailedListOutgoingInvites: ({ organizationId, reason }) =>
			organizationId === model.requestedOrganizationId
				? {
						// A failed refetch keeps the list it had (`Stale`).
						model: modifyFields(model, {
							invites: (invites) =>
								Option.match(AsyncData.getData(invites), {
									onNone: () => Invites.Failure({ error: reason }),
									onSome: (data) => Invites.Stale({ error: reason, data }),
								}),
						}),
					}
				: { model },
		ClickedRetryInvites: () => reloadInvites(model),
		ClickedShareChannel: () => ({ model: modifyFields(model, { share: ShareModal.open }) }),
		ClickedRevokeInvite: ({ inviteId }) =>
			model.revokingInviteIds.includes(inviteId)
				? { model }
				: {
						model: modifyFields(model, {
							revokingInviteIds: (ids) => [...ids, inviteId],
							interaction: (state) =>
								Interaction.disabledTargets(state, [revokeTarget(inviteId)]),
						}),
						commands: [RevokeInvite({ inviteId })],
					},
		SucceededRevokeInvite: ({ inviteId }) => {
			const reloaded = reloadInvites(
				modifyFields(model, { revokingInviteIds: (ids) => without(ids, inviteId) }),
			)
			return {
				...reloaded,
				outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite revoked") }),
			}
		},
		FailedRevokeInvite: ({ inviteId, reason }) => ({
			model: modifyFields(model, { revokingInviteIds: (ids) => without(ids, inviteId) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Invite not found",
							description: "This invite may have already been revoked or expired.",
						},
						NotRevokable: {
							title: "Cannot revoke",
							description: "This invite is no longer in a revokable state.",
						},
					}),
				),
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		ClickedDisconnect: ({ mountId }) => {
			const mount = model.mounts.find((candidate) => candidate.id === mountId)
			const currentOrgId = shared.organization?.id ?? null
			if (mount === undefined || model.disconnectingMountIds.includes(mountId)) return { model }
			const viewerRole = model.mounts.find(
				(candidate) => candidate.organizationId === currentOrgId,
			)?.role
			const roles = rowRoles(mount, viewerRole, currentOrgId)
			// The view hides the button for a viewer who may not disconnect this row; update checks too.
			if (!roles.canDisconnect || roles.targetOrganizationId === null) return { model }
			return {
				model: modifyFields(model, { disconnectingMountIds: (ids) => [...ids, mountId] }),
				commands: [
					DisconnectOrganization({
						mountId,
						conversationId: mount.conversationId,
						organizationId: roles.targetOrganizationId,
						isLeaving: roles.isGuestLeavingConversation,
					}),
				],
			}
		},
		SucceededDisconnect: ({ mountId, successMessage }) => ({
			model: modifyFields(model, { disconnectingMountIds: (ids) => without(ids, mountId) }),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}),
		FailedDisconnect: ({ mountId, reason }) => ({
			model: modifyFields(model, { disconnectingMountIds: (ids) => without(ids, mountId) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Connection not found",
							description: "This organization may already be disconnected.",
						},
					}),
				),
			}),
		}),
		GotShareModalMessage: ({ message: shareMessage }) => {
			const next = ShareModal.update(model.share, shareMessage, {
				channelId: model.channelId,
				organizationId: shared.organization?.id ?? null,
			})
			const withShare = modifyFields(model, { share: () => next.model })
			const reloaded =
				shareMessage._tag === "SucceededCreateInvite"
					? reloadInvites(withShare)
					: { model: withShare }
			return {
				model: reloaded.model,
				commands: [
					...Command.mapMessages(next.commands ?? [], (child) =>
						Message.GotShareModalMessage({ message: child }),
					),
					...(reloaded.commands ?? []),
				],
				outMessage: next.outMessage,
			}
		},
	})
