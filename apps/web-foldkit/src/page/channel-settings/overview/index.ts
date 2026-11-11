import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/channels/$channelId/settings/overview` */
export const page = definePage(
	"ChannelSettingsOverview",
	{ Model, Message },
	{ routes: ["ChannelSettingsOverview"], init, update, view, subscriptions },
)
