import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Tabs from "../../ui/tabs"
import { ChannelGroups, Presence } from "./model"

export const Message = defineMessageUnion({
	UpdatedChannels: { groups: ChannelGroups },
	UpdatedPresence: { presence: Schema.Record(Schema.String, Presence) },
	GotTabsMessage: { message: Tabs.Message },
	PressedCreateChannel: {},
	PressedStartConversation: {},
})
export type Message = typeof Message.Type
