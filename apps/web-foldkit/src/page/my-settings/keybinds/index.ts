import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/keybinds`: Discord's Keybinds settings. */
export const page = definePage(
	"MySettingsKeybinds",
	{ Model, Message },
	{ routes: ["MySettingsKeybinds"], init, update, view, subscriptions },
)
