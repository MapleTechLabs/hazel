import { BotCommandId, BotId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { Generated, JsonDate } from "./utils"

/**
 * Argument definition for a bot command
 */
export const BotCommandArgument = S.Struct({
	name: S.String,
	description: S.NullOr(S.String),
	required: S.Boolean,
	placeholder: S.NullOr(S.String),
	type: S.Literals(["string", "number", "user", "channel"]),
})
export type BotCommandArgument = typeof BotCommandArgument.Type

class Model extends M.Class<Model>("BotCommand")({
	id: M.Generated(BotCommandId),
	botId: BotId,
	name: S.String,
	description: S.String,
	arguments: S.NullOr(S.Array(BotCommandArgument)),
	usageExample: S.NullOr(S.String),
	isEnabled: S.Boolean,
	createdAt: Generated(JsonDate),
	updatedAt: Generated(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
