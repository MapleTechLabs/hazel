import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/sources/unmatched`: link, create or ignore the records no account claims. */
export const page = definePage(
	"CustomersUnmatched",
	{ Model, Message },
	{ routes: ["CustomersUnmatched"], init, update, view, subscriptions, sharedChanged },
)
