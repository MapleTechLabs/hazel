import type { OrganizationMemberId } from "@hazel/schema"
import { modifyFields } from "foldkit/struct"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Model } from "./model"

export const init = (): PageReturn<Model, Message> => ({ model: { members: [], isLoaded: false } })

/** The change role modal for a member, decided against the signed-in user's own row. */
const clickedChangeRole = (
	model: Model,
	memberId: OrganizationMemberId,
	shared: Shared,
): PageReturn<Model, Message> => {
	const target = model.members.find((member) => member.id === memberId)
	const current = model.members.find((member) => member.userId === shared.currentUser?.id)
	if (target === undefined || current === undefined) return { model }
	return {
		model,
		outMessage: PageOutMessage.RequestedModal({
			modal: {
				_tag: "ChangeRole",
				userId: target.userId,
				memberId: target.id,
				name: `${target.firstName} ${target.lastName}`.trim(),
				role: target.role,
				currentUserRole: current.role,
			},
		}),
	}
}

export const update = (model: Model, message: Message, shared: Shared): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedTeamMembers: ({ members }) => ({
			model: modifyFields(model, { members: () => members, isLoaded: () => true }),
		}),
		// Legacy opens `EmailInviteModal`, the same modal the invitations page requests.
		ClickedInviteUser: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }),
		}),
		ClickedChangeRole: ({ memberId }) => clickedChangeRole(model, memberId, shared),
	})
