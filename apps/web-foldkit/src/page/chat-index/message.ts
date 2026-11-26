import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Tabs from "../../ui/tabs"
import { ChannelGroups, DmFilter, Presence } from "./model"

export const Message = defineMessageUnion({
	UpdatedChannels: { groups: ChannelGroups },
	UpdatedPresence: { presence: Schema.Record(Schema.String, Presence) },
	GotTabsMessage: { message: Tabs.Message },
	PressedCreateChannel: {},
	PressedStartConversation: {},
	PressedDmFilter: { filter: DmFilter },
	/** The DMs island (`islands/dms.ts`) asked to open a DM. */
	RequestedIslandNavigation: { orgSlug: Schema.String, channelId: ChannelId },
})
export type Message = typeof Message.Type
