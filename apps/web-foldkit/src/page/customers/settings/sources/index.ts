import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/sources/$provider`: one source's detail (the overview is native). */
export const page = definePage(
	"CustomersSettingsSources",
	{ Model, Message },
	{
		routes: ["CustomersSourceDetail"],
		init,
		update,
		view,
		subscriptions,
	},
)
