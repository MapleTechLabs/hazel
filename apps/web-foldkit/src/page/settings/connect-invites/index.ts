import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/connect-invites` */
export const page = definePage(
	"SettingsConnectInvites",
	{ Model, Message },
	{ routes: ["SettingsConnectInvites"], init, update, view, subscriptions, sharedChanged },
)
