import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Bot } from "../shared/bots"

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	/** Null until the live query is ready (legacy `status === "loading"`). */
	bots: Schema.NullOr(Schema.Array(Bot)),
	/** Bots whose uninstall is in flight; legacy keeps the button enabled, so update ignores repeats. */
	uninstallingBotIds: Schema.Array(BotId),
})
export type Model = typeof Model.Type
