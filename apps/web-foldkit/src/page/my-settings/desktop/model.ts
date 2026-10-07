import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"

export const Model = Schema.Struct({
	/** `null` until `isAutostartEnabled()` answers (the switch is disabled meanwhile). */
	autostartEnabled: Schema.NullOr(Schema.Boolean),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
