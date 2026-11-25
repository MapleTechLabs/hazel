import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/groups` */
export const page = definePage(
	"SettingsGroups",
	{ Model, Message },
	{ routes: ["SettingsGroups"], init, update, view, subscriptions },
)
