import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers`: revenue, usage and health across the org's customers. */
export const page = definePage(
	"CustomersOverview",
	{ Model, Message },
	{ routes: ["CustomersOverview"], init, update, sharedChanged, view, subscriptions },
)
