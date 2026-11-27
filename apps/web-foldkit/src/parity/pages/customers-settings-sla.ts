import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/settings/sla`: business hours, three policies, triage. */
export default {
	flag: "hazel:native:CustomersSettingsSla",
	href: "/hazel/customers/settings/sla",
	island: "[data-hz-key=customers-settings-sla]",
	wide: true,
	steps: [{ waitFor: "text=Acme escalation >> visible=true" }],
} satisfies ComparePage
