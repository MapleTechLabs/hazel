import * as CustomersAttention from "./attention"
import * as CustomerDetail from "./detail"
import * as CustomersList from "./list"
import * as CustomersOverview from "./overview"
import * as CustomersSettingsHealth from "./settings/health"
import * as CustomersSettingsPlans from "./settings/plans"
import * as CustomersSettingsSignals from "./settings/signals"
import * as CustomersSettingsSources from "./settings/sources"
import * as CustomersUnmatched from "./settings/unmatched"

/** The Customers area's pages: their own chunk, loaded with the first Customers route (`../registry.ts`). */
export const pages = [
	CustomersOverview.page,
	CustomersAttention.page,
	CustomersList.page,
	CustomerDetail.page,
	CustomersSettingsSignals.page,
	CustomersSettingsHealth.page,
	CustomersSettingsPlans.page,
	CustomersSettingsSources.page,
	CustomersUnmatched.page,
]
