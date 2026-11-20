import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, routeChanged, sharedChanged, update } from "./update"
import { view } from "./view"

/**
 * `/$orgSlug/customers/settings/metrics` (the catalog), `…/metrics/new?key=&source=` (a new metric,
 * prefilled from a suggested one) and `…/metrics/$metricKey` (the editor). Keyed by org: moving
 * between the catalog and the editor is a `routeChanged`, so the live rows carry over.
 */
export const page = definePage(
	"CustomersSettingsMetrics",
	{ Model, Message },
	{
		routes: ["CustomersSettingsMetrics", "CustomersSettingsMetricNew", "CustomersSettingsMetric"],
		key: (route) => route.orgSlug,
		init,
		update,
		routeChanged,
		sharedChanged,
		view,
		subscriptions,
	},
)
