import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../../overlay/toasts"
import { Bot } from "../shared/bots"

export const Message = defineMessageUnion({
	UpdatedBots: { bots: Schema.Array(Bot) },
	ClickedUninstall: { botId: BotId },
	SucceededUninstallBot: { botId: BotId },
	FailedUninstallBot: { botId: BotId, toast: ToastRequest },
	ClickedBrowseMarketplace: {},
	ClickedInstallById: {},
})
export type Message = typeof Message.Type
