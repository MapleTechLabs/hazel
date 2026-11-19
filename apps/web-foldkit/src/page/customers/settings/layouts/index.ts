import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, sharedChanged, update } from "./update"
import { view } from "./view"

/**
 * `/$orgSlug/customers/settings/layouts` (the list), `…/layouts/new?from=&name=&preview=` (a new
 * layout's editor) and `…/layouts/$layoutId?preview=` (a layout's editor). Keyed by org: moving
 * between the list and the editor is a `routeChanged`, so the live rows carry over.
 */
export const page = definePage(
	"CustomersSettingsLayouts",
	{ Model, Message },
	{
		routes: ["CustomersSettingsLayouts", "CustomersSettingsLayoutNew", "CustomersSettingsLayout"],
		key: (route) => route.orgSlug,
		init,
		update,
		routeChanged,
		sharedChanged,
		view,
		subscriptions,
	},
)
