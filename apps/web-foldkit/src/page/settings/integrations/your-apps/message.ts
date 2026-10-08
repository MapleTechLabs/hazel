import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../../../../ui/menu"
import { Bot } from "../shared/bots"

export const Message = defineMessageUnion({
	UpdatedBots: { bots: Schema.Array(Bot) },
	GotMenuMessage: { botId: BotId, message: Menu.Message },
	ClickedCreateApplication: {},
})
export type Message = typeof Message.Type
