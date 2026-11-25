import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/notifications` (Mentions) and its `unreads` and `all` tabs; the former source tabs redirect to All. */
export const page = definePage(
	"NotificationsInbox",
	{ Model, Message },
	{
		routes: [
			"NotificationsMentions",
			"NotificationsUnreads",
			"NotificationsAll",
			"NotificationsGeneral",
			"NotificationsThreads",
			"NotificationsDms",
		],
		key: (route) => route.orgSlug,
		init: (route) => init(route),
		update: (model, message, shared) => update(model, message, shared),
		routeChanged: (model, route) => routeChanged(model, route),
		view,
		subscriptions,
	},
)
