import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/channels/$channelId/settings/integrations` */
export const page = definePage(
	"ChannelSettingsIntegrations",
	{ Model, Message },
	{ routes: ["ChannelSettingsIntegrations"], init, update, view, subscriptions },
)
