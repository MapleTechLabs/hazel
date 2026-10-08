import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/profile/$userId` */
export const page = definePage(
	"Profile",
	{ Model, Message },
	{
		routes: ["Profile"],
		key: (route) => route.userId,
		init: (route) => init(route.userId),
		update: (model, message) => update(model, message),
		view,
		subscriptions,
	},
)
