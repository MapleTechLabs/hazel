import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/health`: how the health score is built, with a dry run of the edits. */
export const page = definePage(
	"CustomersSettingsHealth",
	{ Model, Message },
	{ routes: ["CustomersSettingsHealth"], init, update, view, subscriptions },
)
