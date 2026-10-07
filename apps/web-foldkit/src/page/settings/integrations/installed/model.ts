import { Schema } from "effect"
import { Bot } from "../shared/bots"

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	/** Null until the live query is ready (legacy `status === "loading"`). */
	bots: Schema.NullOr(Schema.Array(Bot)),
})
export type Model = typeof Model.Type
