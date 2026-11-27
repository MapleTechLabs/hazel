import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/settings/plans`: four plans, one an add-on. */
export default {
	flag: "hazel:native:CustomersSettingsPlans",
	href: "/hazel/customers/settings/plans",
	island: "[data-hz-key=customers-settings-plans]",
	wide: true,
	steps: [{ waitFor: "text=Starter >> visible=true" }],
} satisfies ComparePage
