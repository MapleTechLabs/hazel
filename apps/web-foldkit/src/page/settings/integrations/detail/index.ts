import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations/$integrationId` */
export const page = definePage(
	"IntegrationSettings",
	{ Model, Message },
	{
		routes: ["SettingsIntegration"],
		init,
		update,
		view,
		subscriptions,
	},
)
