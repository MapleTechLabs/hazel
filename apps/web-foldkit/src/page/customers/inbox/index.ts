import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/inbox`: support issues across the linked channels. */
export const page = definePage(
	"CustomersInbox",
	{ Model, Message },
	{ routes: ["CustomersInbox"], init, update, view, subscriptions },
)
