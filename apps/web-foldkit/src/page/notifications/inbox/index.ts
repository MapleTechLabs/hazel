import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/notifications` and its `general`, `threads` and `dms` tabs. */
export const page = definePage(
	"NotificationsInbox",
	{ Model, Message },
	{
		routes: ["NotificationsAll", "NotificationsGeneral", "NotificationsThreads", "NotificationsDms"],
		key: (route) => route.orgSlug,
		init: (route) => init(route),
		update: (model, message) => update(model, message),
		routeChanged: (model, route) => routeChanged(model, route),
		view,
		subscriptions,
	},
)
