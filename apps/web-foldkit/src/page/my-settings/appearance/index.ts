import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings` (Appearance) */
export const page = definePage(
	"MySettingsAppearance",
	{ Model, Message },
	{ routes: ["MySettingsAppearance"], init, update, view, subscriptions, sharedChanged },
)
