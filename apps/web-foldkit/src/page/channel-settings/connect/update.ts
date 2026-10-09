import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import { successToast } from "../../../data/actions"
import { embedInteraction } from "../../settings/integrations/shared/interaction"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { DisconnectOrganization, ListOutgoingInvites, RevokeInvite } from "./command"
import { Message, type Model, rowRoles } from "./model"
import * as ShareModal from "./share-modal"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

/** The interaction target of an invite's Revoke button. */
export const revokeTarget = (inviteId: string) => `revoke-${inviteId}`

const requestInvites = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedOrganizationId) return { model }
	return {
		model: modifyFields(model, { requestedOrganizationId: () => organizationId, invites: () => [] }),
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
			invites: [],
			revokingInviteIds: [],
			disconnectingMountIds: [],
			share: ShareModal.init(),
			interaction: Interaction.init(),
		},
		shared,
	)

export const sharedChanged = (model: Model, shared: Shared): Return => requestInvites(model, shared)

/** The reactivity key `connectInvites:outgoing:<org>` refetches the list after a write. */
const refetchInvites = (model: Model) =>
	model.requestedOrganizationId === null
		? []
		: [ListOutgoingInvites({ organizationId: model.requestedOrganizationId, channelId: model.channelId })]

const without = <Id extends string>(ids: ReadonlyArray<Id>, id: Id): ReadonlyArray<Id> =>
	ids.filter((candidate) => candidate !== id)

const toastOut = (title: string, description: string | null) =>
	PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } })

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedChannelName: ({ name }) => ({ model: modifyFields(model, { channelName: () => name }) }),
		UpdatedMounts: ({ mounts }) => ({ model: modifyFields(model, { mounts: () => mounts }) }),
		UpdatedOrgs: ({ orgs }) => ({ model: modifyFields(model, { orgs: () => orgs }) }),
		SucceededListOutgoingInvites: ({ organizationId, invites }) =>
			organizationId === model.requestedOrganizationId
				? { model: modifyFields(model, { invites: () => invites }) }
				: { model },
		FailedListOutgoingInvites: () => ({ model }),
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
		SucceededRevokeInvite: ({ inviteId }) => ({
			model: modifyFields(model, { revokingInviteIds: (ids) => without(ids, inviteId) }),
			commands: refetchInvites(model),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite revoked") }),
		}),
		FailedRevokeInvite: ({ inviteId, title, description }) => ({
			model: modifyFields(model, { revokingInviteIds: (ids) => without(ids, inviteId) }),
			outMessage: toastOut(title, description),
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
		FailedDisconnect: ({ mountId, title, description }) => ({
			model: modifyFields(model, { disconnectingMountIds: (ids) => without(ids, mountId) }),
			outMessage: toastOut(title, description),
		}),
		GotShareModalMessage: ({ message: shareMessage }) => {
			const next = ShareModal.update(model.share, shareMessage, {
				channelId: model.channelId,
				organizationId: shared.organization?.id ?? null,
			})
			const sentInvite = shareMessage._tag === "SucceededCreateInvite"
			return {
				model: modifyFields(model, { share: () => next.model }),
				commands: [
					...Command.mapMessages(next.commands ?? [], (child) =>
						Message.GotShareModalMessage({ message: child }),
					),
					...(sentInvite ? refetchInvites(model) : []),
				],
				outMessage: next.outMessage,
			}
		},
	})
