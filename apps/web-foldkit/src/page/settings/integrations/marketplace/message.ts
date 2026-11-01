import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../../ui/aria/interaction"
import { PublicBot } from "../shared/bots"

/** What can go wrong installing a bot, beyond the shared reasons. */
export const InstallFailure = Schema.Union([
	Schema.Literals(["NotFound", "AlreadyInstalled", "NoActiveOrganization"]),
	CommonReason,
])
export type InstallFailure = typeof InstallFailure.Type

export const Message = defineMessageUnion({
	UpdatedPublicBots: { bots: Schema.Array(PublicBot) },
	UpdatedInstalledBotIds: { botIds: Schema.Array(BotId) },
	ChangedSearch: { search: Schema.String },
	ClickedInstall: { botId: BotId },
	SucceededInstallBot: { botId: BotId },
	FailedInstallBot: { botId: BotId, reason: InstallFailure },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
