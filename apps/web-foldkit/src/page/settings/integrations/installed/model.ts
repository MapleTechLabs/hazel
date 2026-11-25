import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Bot } from "../shared/bots"

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	/** Null until the live query is ready (legacy `status === "loading"`). */
	bots: Schema.NullOr(Schema.Array(Bot)),
	/** The bot whose card asks "Uninstall?" (the first press arms it, the second uninstalls). */
	confirmingUninstallId: Schema.NullOr(BotId),
	/** Bots whose uninstall is in flight; their button is pending and update ignores repeats. */
	uninstallingBotIds: Schema.Array(BotId),
})
export type Model = typeof Model.Type
