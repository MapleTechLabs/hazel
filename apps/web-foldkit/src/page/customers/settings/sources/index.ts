import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/sources[/$provider]`: data sources, and one source's detail. */
export const page = definePage(
	"CustomersSettingsSources",
	{ Model, Message },
	{
		routes: ["CustomersSettingsSources", "CustomersSourceDetail"],
		init,
		update,
		sharedChanged,
		view,
		subscriptions,
	},
)
