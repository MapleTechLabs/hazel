import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"

export const Model = Schema.Struct({
	/** `null` until `isAutostartEnabled()` answers (the switch is disabled meanwhile). */
	autostartEnabled: Schema.NullOr(Schema.Boolean),
	/** A `SetAutostart` is running; further toggles wait for its result. */
	isUpdating: Schema.Boolean,
	/** The installed app's version (Tauri `getVersion`); `null` until it answers. */
	version: Schema.NullOr(Schema.String),
	/** The app can open at login: the Tauri app's autostart plugin (not the native app, not a browser). */
	hasAutostart: Schema.Boolean,
	/** The app updates itself: the Tauri app, and the native app, whose host answers the updater. */
	hasUpdates: Schema.Boolean,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
