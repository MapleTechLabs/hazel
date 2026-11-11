import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"

/** The autostart plugin rejected the write. */
export const SetAutostartFailure = Schema.Literal("PluginFailed")
export type SetAutostartFailure = typeof SetAutostartFailure.Type

export const Message = defineMessageUnion({
	CheckedAutostart: { isEnabled: Schema.Boolean },
	ToggledAutostart: { isSelected: Schema.Boolean },
	SucceededSetAutostart: { isEnabled: Schema.Boolean },
	/** `isEnabled` is the state re-read after the failed write, so the switch shows the truth. */
	FailedSetAutostart: { reason: SetAutostartFailure, isEnabled: Schema.Boolean },
	GotInteractionMessage: { message: Interaction.Message },
	ReadAppVersion: { version: Schema.NullOr(Schema.String) },
	ClickedCheckForUpdates: {},
	ClickedInstallUpdate: {},
})
export type Message = typeof Message.Type
