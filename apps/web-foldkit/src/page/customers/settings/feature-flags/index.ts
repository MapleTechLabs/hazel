import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/customers/settings/feature-flags`: the Clerk feature flags and which customers have them. */
export const page = definePage(
	"CustomersSettingsFeatureFlags",
	{ Model, Message },
	{ routes: ["CustomersSettingsFeatureFlags"], init, update, view, subscriptions },
)
