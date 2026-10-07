import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import * as Interaction from "../../../../ui/aria/interaction"
import { PublicBot } from "../shared/bots"

export const Model = Schema.Struct({
	search: Schema.String,
	/** Null until the public bots query is ready (legacy `status === "loading"`). */
	bots: Schema.NullOr(Schema.Array(PublicBot)),
	installedBotIds: Schema.Array(BotId),
	installingBotIds: Schema.Array(BotId),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
