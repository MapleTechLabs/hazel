import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, sharedChanged, update } from "./update"
import { view } from "./view"

/**
 * `/$orgSlug/customers/settings/signals` (the rules), `…/signals/new?template=` (a new rule, or the
 * template picker without one) and `…/signals/$ruleId` (the editor). Keyed by org: moving between
 * the list and the editor is a `routeChanged`, so the live rows (rules, accounts, signals) carry over
 * and the editor opens with them at once.
 */
export const page = definePage(
	"CustomersSettingsSignals",
	{ Model, Message },
	{
		routes: ["CustomersSettingsSignals", "CustomersSettingsSignalNew", "CustomersSettingsSignalRule"],
		key: (route) => route.orgSlug,
		init,
		update,
		routeChanged,
		sharedChanged,
		view,
		subscriptions,
	},
)
