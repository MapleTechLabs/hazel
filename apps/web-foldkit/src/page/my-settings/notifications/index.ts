import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/notifications` */
export const page = definePage(
	"MySettingsNotifications",
	{ Model, Message },
	{ routes: ["MySettingsNotifications"], init, update, view, subscriptions, sharedChanged },
)
