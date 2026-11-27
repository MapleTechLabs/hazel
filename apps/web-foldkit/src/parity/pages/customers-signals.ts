import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/settings/signals`: five rules, Stripe connected (fixture `customers-signals`). */
export default {
	flag: "hazel:native:CustomersSettingsSignals",
	href: "/hazel/customers/settings/signals",
	island: "[data-hz-key=signals]",
	wide: true,
	steps: [{ waitFor: "text=Payment failed >> visible=true" }],
} satisfies ComparePage
