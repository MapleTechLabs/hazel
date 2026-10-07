import { Schema } from "effect"
import * as Menu from "../../../../ui/menu"
import { Bot } from "../shared/bots"

export const Model = Schema.Struct({
	/** Null until the live query is ready (legacy `status === "loading"`). */
	bots: Schema.NullOr(Schema.Array(Bot)),
	/** One "Bot actions" menu per bot, in the same order. */
	menus: Schema.Array(Menu.Model),
})
export type Model = typeof Model.Type
