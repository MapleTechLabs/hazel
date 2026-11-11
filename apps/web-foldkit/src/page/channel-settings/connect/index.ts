import { definePage } from "../../contract"
import { Message, Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/channels/$channelId/settings/connect` */
export const page = definePage(
	"ChannelSettingsConnect",
	{ Model, Message },
	{ routes: ["ChannelSettingsConnect"], init, update, view, subscriptions, sharedChanged },
)
