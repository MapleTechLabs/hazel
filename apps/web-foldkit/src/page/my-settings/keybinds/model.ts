import { Schema } from "effect"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { MODIFIER_ORDER } from "~/lib/keybindings/key-combo"

export const ActionId = appKeymap.ActionId
export type ActionId = typeof ActionId.Type

/** What the last change did to other actions, shown under its row until the next change. */
export const Notice = Schema.Struct({
	actionId: ActionId,
	tone: Schema.Literals(["info", "warning"]),
	text: Schema.String,
})
export type Notice = typeof Notice.Type

export const Model = Schema.Struct({
	/** Filters the actions by label, description and key. */
	query: Schema.String,
	/** The action whose new key is being recorded: the next key press becomes it. */
	recording: Schema.NullOr(ActionId),
	/** The modifiers held while recording, shown live before the key lands. */
	held: Schema.Array(Schema.Literals(MODIFIER_ORDER)),
	notice: Schema.NullOr(Notice),
})
export type Model = typeof Model.Type
