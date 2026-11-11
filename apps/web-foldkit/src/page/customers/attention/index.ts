import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/attention`: the ranked signal queue. */
export const page = definePage(
	"CustomersAttention",
	{ Model, Message },
	{ routes: ["CustomersAttention"], init, update, view, subscriptions },
)
