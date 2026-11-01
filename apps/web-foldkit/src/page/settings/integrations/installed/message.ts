import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { Bot } from "../shared/bots"

/** What can go wrong uninstalling a bot, beyond the shared reasons. */
export const UninstallFailure = Schema.Union([
	Schema.Literals(["NotFound", "NoActiveOrganization"]),
	CommonReason,
])
export type UninstallFailure = typeof UninstallFailure.Type

export const Message = defineMessageUnion({
	UpdatedBots: { bots: Schema.Array(Bot) },
	ClickedUninstall: { botId: BotId },
	SucceededUninstallBot: { botId: BotId },
	FailedUninstallBot: { botId: BotId, reason: UninstallFailure },
	ClickedBrowseMarketplace: {},
	ClickedInstallById: {},
})
export type Message = typeof Message.Type
