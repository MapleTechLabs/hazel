import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { RouteOf } from "../../route"
import * as Tabs from "../../ui/tabs"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import { Channels, ChatIndexTabs, type Model, TABS_ID } from "./model"

export const init = (route: RouteOf<"ChatIndex" | "ChatDms">): PageReturn<Model, Message> => ({
	model: {
		channels: Channels.Loading(),
		presence: {},
		tab: route._tag === "ChatDms" ? "dms" : "public",
		isDmList: route._tag === "ChatDms",
		tabs: Tabs.init({ id: TABS_ID }),
	},
})

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedChannels: ({ groups }) => ({
			model: modifyFields(model, { channels: () => Channels.Loaded({ groups }) }),
		}),
		UpdatedPresence: ({ presence }) => ({ model: modifyFields(model, { presence: () => presence }) }),
		GotTabsMessage: ({ message: tabsMessage }) => {
			const result = ChatIndexTabs.update(model.tabs, tabsMessage)
			const selected = result.outMessage
			return {
				model: modifyFields(model, {
					tabs: () => result.model,
					tab: (tab) => (selected === undefined ? tab : selected.value),
				}),
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
