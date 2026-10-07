import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"

/** The user-level Discord connection row (`useUserIntegrationConnection`). */
export const DiscordConnection = Schema.Struct({
	status: Schema.String,
	externalAccountName: Schema.NullOr(Schema.String),
})
export type DiscordConnection = typeof DiscordConnection.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	connection: Schema.NullOr(DiscordConnection),
	isConnecting: Schema.Boolean,
	isDisconnecting: Schema.Boolean,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
