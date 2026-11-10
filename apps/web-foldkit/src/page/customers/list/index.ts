import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/list?view=`: every customer account, through saved views. */
export const page = definePage(
	"CustomersList",
	{ Model, Message },
	{
		routes: ["CustomersList"],
		// One instance across saved views: `?view=` arrives as `routeChanged`.
		key: (route) => route.orgSlug,
		init,
		update,
		routeChanged,
		view,
		subscriptions,
	},
)
