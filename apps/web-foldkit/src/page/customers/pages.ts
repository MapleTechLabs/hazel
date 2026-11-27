import * as CustomerDetail from "./detail"
import * as CustomersInbox from "./inbox"
import * as CustomersList from "./list"
import * as CustomersSettingsFeatureFlags from "./settings/feature-flags"
import * as CustomersSettingsPlans from "./settings/plans"
import * as CustomersSettingsSla from "./settings/sla"
import * as CustomersSettingsSources from "./settings/sources"
import * as CustomersUnmatched from "./settings/unmatched"

/** The Customers area's pages: their own chunk, loaded with the first Customers route (`../registry.ts`). */
export const pages = [
	CustomersInbox.page,
	CustomersList.page,
	CustomerDetail.page,
	CustomersSettingsPlans.page,
	CustomersSettingsSla.page,
	CustomersSettingsFeatureFlags.page,
	CustomersSettingsSources.page,
	CustomersUnmatched.page,
]
