import * as CustomersAttention from "./attention"
import * as CustomerDetail from "./detail"
import * as CustomersInbox from "./inbox"
import * as CustomersList from "./list"
import * as CustomersOverview from "./overview"
import * as CustomersSettingsSignals from "./settings/signals"
import * as CustomersSettingsSources from "./settings/sources"
import * as CustomersSupportReport from "./support"
import * as CustomersUnmatched from "./settings/unmatched"

/** The Customers area's pages: their own chunk, loaded with the first Customers route (`../registry.ts`). */
export const pages = [
	CustomersOverview.page,
	CustomersAttention.page,
	CustomersInbox.page,
	CustomersSupportReport.page,
	CustomersList.page,
	CustomerDetail.page,
	CustomersSettingsSignals.page,
	CustomersSettingsSources.page,
	CustomersUnmatched.page,
]
