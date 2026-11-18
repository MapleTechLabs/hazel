import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/sources[/$provider]`: data sources, and one source's detail. */
export const page = definePage(
	"CustomersSettingsSources",
	{ Model, Message },
	{
		routes: ["CustomersSettingsSources", "CustomersSourceDetail"],
		// Gmail's connect result in the query is cleaned from the URL by the same instance.
		key: (route) =>
			route._tag === "CustomersSourceDetail" ? `${route.orgSlug}/${route.provider}` : route.orgSlug,
		init,
		routeChanged,
		update,
		sharedChanged,
		view,
		subscriptions,
	},
)
