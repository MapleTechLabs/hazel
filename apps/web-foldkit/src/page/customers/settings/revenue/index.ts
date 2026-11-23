import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/**
 * `/$orgSlug/customers/settings/revenue`: the ordered rules that class each billing line as
 * recurring, variable, one-off or excluded, and the variable MRR window, with a preview of the edits.
 */
export const page = definePage(
	"CustomersSettingsRevenue",
	{ Model, Message },
	{ routes: ["CustomersSettingsRevenue"], init, update, view, subscriptions, sharedChanged },
)
