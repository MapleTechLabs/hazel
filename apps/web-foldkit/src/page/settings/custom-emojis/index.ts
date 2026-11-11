import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/custom-emojis` */
export const page = definePage(
	"SettingsCustomEmojis",
	{ Model, Message },
	{ routes: ["SettingsCustomEmojis"], init, update, view, subscriptions },
)
