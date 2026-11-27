import type { ComparePage } from "../compare-entry"

/** `/hazel/customers`: the Customers overview over the lab org (headline, queue, lists; trends folded). */
export default {
	flag: "hazel:native:CustomersOverview",
	href: "/hazel/customers",
	island: '[data-native-page="customers-overview"]',
	wide: true,
	steps: [{ waitFor: "text=Lumen Health >> visible=true" }],
} satisfies ComparePage
