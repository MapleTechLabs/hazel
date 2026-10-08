import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/linked-accounts` */
export const page = definePage(
	"MySettingsLinkedAccounts",
	{ Model, Message },
	{
		routes: ["MySettingsLinkedAccounts"],
		key: ({ orgSlug }) => orgSlug,
		init,
		update,
		view,
		subscriptions,
		routeChanged,
	},
)
