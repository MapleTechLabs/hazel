import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/plans`: which plans are add-ons billed on top of a base plan. */
export const page = definePage(
	"CustomersSettingsPlans",
	{ Model, Message },
	{ routes: ["CustomersSettingsPlans"], init, update, view, subscriptions, sharedChanged },
)
