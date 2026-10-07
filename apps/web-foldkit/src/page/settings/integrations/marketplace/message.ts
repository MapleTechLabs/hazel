import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../../ui/aria/interaction"
import { ToastRequest } from "../../../../overlay/toasts"
import { PublicBot } from "../shared/bots"

export const Message = defineMessageUnion({
	UpdatedPublicBots: { bots: Schema.Array(PublicBot) },
	UpdatedInstalledBotIds: { botIds: Schema.Array(BotId) },
	ChangedSearch: { search: Schema.String },
	ClickedInstall: { botId: BotId },
	SucceededInstallBot: { botId: BotId },
	FailedInstallBot: { botId: BotId, toast: ToastRequest },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
