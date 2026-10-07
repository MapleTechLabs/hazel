import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/chat`: the channel browser. */
export const page = definePage(
	"ChatIndex",
	{ Model, Message },
	{ routes: ["ChatIndex"], init, update: (model, message) => update(model, message), view, subscriptions },
)
