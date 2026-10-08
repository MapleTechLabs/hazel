import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"

export const Message = defineMessageUnion({
	CheckedAutostart: { isEnabled: Schema.Boolean },
	ToggledAutostart: { isSelected: Schema.Boolean },
	CompletedSetAutostart: { isEnabled: Schema.Boolean },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
