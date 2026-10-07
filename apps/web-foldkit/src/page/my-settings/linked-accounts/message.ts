import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import { DiscordConnection } from "./model"

export const Message = defineMessageUnion({
	/** The OAuth callback's search params (`connection_status`, `provider`, `error_code`). */
	ReadLinkResult: {
		connectionStatus: Schema.NullOr(Schema.String),
		provider: Schema.NullOr(Schema.String),
		errorCode: Schema.NullOr(Schema.String),
	},
	ShowedLinkResult: {},
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
