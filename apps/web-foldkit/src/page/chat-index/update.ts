import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Tabs from "../../ui/tabs"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import { type Model, TABS_ID } from "./model"

export const init = (): PageReturn<Model, Message> => ({
	model: { groups: null, presence: {}, tabs: Tabs.init({ id: TABS_ID, selectedKey: "public" }) },
})

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedChannels: ({ groups }) => ({ model: modifyFields(model, { groups: () => groups }) }),
		UpdatedPresence: ({ presence }) => ({ model: modifyFields(model, { presence: () => presence }) }),
		GotTabsMessage: ({ message: tabsMessage }) => {
			const result = Tabs.update(model.tabs, tabsMessage)
			return {
				model: modifyFields(model, { tabs: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotTabsMessage({ message: child }),
				),
			}
		},
		PressedCreateChannel: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } }),
		}),
		PressedStartConversation: () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "CreateDm" } }),
		}),
	})
