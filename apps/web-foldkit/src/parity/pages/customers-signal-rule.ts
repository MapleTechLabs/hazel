import type { ComparePage } from "../compare-entry"

/** A saved rule's editor (Payment failed); PK7b adds the live preview beside it. */
export default {
	flag: "hazel:native:CustomersSettingsSignalRule",
	href: "/hazel/customers/settings/signals/00000000-0000-4000-8000-0000000c0002",
	island: "[data-hz-key=signal-rule]",
	wide: true,
	steps: [{ waitFor: "text=In plain words >> visible=true" }],
} satisfies ComparePage
