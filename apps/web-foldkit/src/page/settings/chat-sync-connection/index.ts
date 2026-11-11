import { definePage } from "../../contract"
import { Message, Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/chat-sync/$connectionId` */
export const page = definePage(
	"SettingsChatSyncConnection",
	{ Model, Message },
	{ routes: ["SettingsChatSyncConnection"], init, update, view, subscriptions, sharedChanged },
)
