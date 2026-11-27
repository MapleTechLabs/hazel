import type { ComparePage } from "../compare-entry"

/** Feature flags with `beta_inbox` open: its two customers and the picker's button. */
export default {
	flag: "hazel:native:CustomersSettingsFeatureFlags",
	href: "/hazel/customers/settings/feature-flags",
	island: "[data-hz-key=customers-settings-feature-flags]",
	wide: true,
	steps: [{ click: "text=beta_inbox >> visible=true" }, { waitFor: "text=Globex >> visible=true" }],
} satisfies ComparePage
