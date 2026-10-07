import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/profile` */
export const page = definePage(
	"MySettingsProfile",
	{ Model, Message },
	{ routes: ["MySettingsProfile"], init, update, view, subscriptions, sharedChanged },
)
