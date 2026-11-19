import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/chat`: the channel browser; `/$orgSlug/chat/dms`: its direct messages alone. */
export const page = definePage(
	"ChatIndex",
	{ Model, Message },
	{
		routes: ["ChatIndex", "ChatDms"],
		init,
		update: (model, message) => update(model, message),
		view,
		subscriptions,
	},
)
