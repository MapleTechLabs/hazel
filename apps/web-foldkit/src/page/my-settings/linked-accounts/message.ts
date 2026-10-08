import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import { DiscordConnection } from "./model"

export const Message = defineMessageUnion({
	UpdatedDiscordConnection: { connection: Schema.NullOr(DiscordConnection) },
	ClickedLinkDiscord: {},
	SucceededGetDiscordOAuthUrl: {},
	FailedGetDiscordOAuthUrl: {},
	ClickedUnlinkDiscord: {},
	SucceededDisconnectDiscord: {},
	FailedDisconnectDiscord: {},
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
