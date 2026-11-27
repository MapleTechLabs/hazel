import * as CustomerDetail from "./detail"
import * as CustomersInbox from "./inbox"
import * as CustomersList from "./list"
import * as CustomersSettingsSources from "./settings/sources"
import * as CustomersUnmatched from "./settings/unmatched"

/** The Customers area's pages: their own chunk, loaded with the first Customers route (`../registry.ts`). */
export const pages = [
	CustomersInbox.page,
	CustomersList.page,
	CustomerDetail.page,
	CustomersSettingsSources.page,
	CustomersUnmatched.page,
]
