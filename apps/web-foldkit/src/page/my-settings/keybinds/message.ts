import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { KeyCombo, MODIFIER_ORDER } from "~/lib/keybindings/key-combo"
import { ActionId } from "./model"

export const Message = defineMessageUnion({
	ChangedQuery: { value: Schema.String },
	ClearedQuery: {},
	ClickedRecord: { actionId: ActionId },
	/** While recording: the modifiers now held (a press or release of one). */
	ChangedHeldModifiers: { modifiers: Schema.Array(Schema.Literals(MODIFIER_ORDER)) },
	/** While recording: a key landed, with the modifiers held. */
	PressedCombo: { combo: KeyCombo },
	/** Escape, a click elsewhere, or the window losing focus. */
	CancelledRecording: {},
	ClickedReset: { actionId: ActionId },
	ClickedUnbind: { actionId: ActionId },
	ClickedResetAll: {},
})
export type Message = typeof Message.Type
