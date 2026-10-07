import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../../overlay/toasts"
import { Bot } from "../shared/bots"

export const Message = defineMessageUnion({
	UpdatedBots: { bots: Schema.Array(Bot) },
	ClickedUninstall: { botId: BotId },
	SucceededUninstallBot: {},
	FailedUninstallBot: { toast: ToastRequest },
	ClickedBrowseMarketplace: {},
})
export type Message = typeof Message.Type
