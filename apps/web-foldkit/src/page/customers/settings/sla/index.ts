import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/**
 * `/$orgSlug/customers/settings/sla`: the org's business hours, and the support SLA policies (first
 * match wins) with their editor (`docs/customers/sla.md`).
 */
export const page = definePage(
	"CustomersSettingsSla",
	{ Model, Message },
	{ routes: ["CustomersSettingsSla"], init, update, view, subscriptions, sharedChanged },
)
