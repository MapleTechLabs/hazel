import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations/$integrationId` */
export const page = definePage(
	"IntegrationSettings",
	{ Model, Message },
	{
		routes: ["SettingsIntegration"],
		key: ({ orgSlug, integrationId }) => `${orgSlug}/${integrationId}`,
		init,
		routeChanged,
		update,
		view,
		subscriptions,
	},
)
