import type { ComparePage } from "../compare-entry"

/** Data sources: Clerk connected, Stripe backfilling, Maple failing, Autumn to connect (PK9a). */
export default {
	flag: "hazel:native:CustomersSettingsSources",
	href: "/hazel/customers/settings/sources",
	island: '[data-hz-key="customers-sources"]',
	wide: true,
	region: "viewport",
	steps: [{ waitFor: "text=Signing secret set" }],
} satisfies ComparePage
