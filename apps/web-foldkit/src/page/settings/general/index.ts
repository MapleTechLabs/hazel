import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings` */
export const page = definePage(
	"SettingsGeneral",
	{ Model, Message },
	{ routes: ["SettingsGeneral"], init, update, view, subscriptions, sharedChanged },
)
