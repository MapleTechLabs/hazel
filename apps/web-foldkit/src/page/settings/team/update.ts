import { modifyFields } from "foldkit/struct"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Model } from "./model"

export const init = (): PageReturn<Model, Message> => ({ model: { members: [] } })

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedTeamMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		// Legacy opens `EmailInviteModal`, the same modal the invitations page requests.
		ClickedInviteUser: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }),
		}),
	})
