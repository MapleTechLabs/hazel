import { placeholderPage } from "../placeholder"

/** `/$orgSlug/customers/list?view=`: placeholder until the list page lands (agent d). */
export const page = placeholderPage("CustomersList", ["CustomersList"], "Customers", {
	// One instance across saved views: `?view=` arrives as `routeChanged`.
	key: (route) => route.orgSlug,
})
