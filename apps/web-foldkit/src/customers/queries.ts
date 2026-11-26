/** Re-exports `@hazel/shared-screens/customers/data/queries` at its old path, bound to the app's `clientData`. */
import { makeCustomerQueries } from "@hazel/shared-screens/customers/data/queries"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/queries"

export const {
	withCustomersSource,
	accountsStream,
	signalsStream,
	myOpenSignalCountStream,
	savedViewsStream,
	viewLayoutStream,
	connectedProvidersStream,
	settingsSummaryStream,
	orgMembersStream,
	impersonatorsStream,
	createdFeatureFlagsStream,
} = makeCustomerQueries(clientData)
