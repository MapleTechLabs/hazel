import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/settings/feature-flags`: four flags, closed. */
export default {
	flag: "hazel:native:CustomersSettingsFeatureFlags",
	href: "/hazel/customers/settings/feature-flags",
	island: "[data-hz-key=customers-settings-feature-flags]",
	wide: true,
	steps: [{ waitFor: "text=new_onboarding >> visible=true" }],
} satisfies ComparePage
