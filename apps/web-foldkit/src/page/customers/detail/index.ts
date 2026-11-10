import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/$accountId?tab=`: one customer. */
export const page = definePage(
	"CustomerDetail",
	{ Model, Message },
	{
		routes: ["CustomerDetail"],
		// One instance per account: switching tabs arrives as `routeChanged`.
		key: (route) => route.accountId,
		init,
		update,
		routeChanged,
		sharedChanged,
		view,
		subscriptions,
	},
)
