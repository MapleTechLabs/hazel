import { placeholderPage } from "../placeholder"

/** `/$orgSlug/customers/$accountId?tab=`: placeholder until the customer page lands (agent d). */
export const page = placeholderPage("CustomerDetail", ["CustomerDetail"], "Customer", {
	// One instance per account: switching tabs arrives as `routeChanged`.
	key: (route) => route.accountId,
})
