import type { ComparePage } from "../compare-entry"

/** The SLA policy editor, opened on Enterprise from the list. */
export default {
	flag: "hazel:native:CustomersSettingsSla",
	href: "/hazel/customers/settings/sla",
	island: "[data-hz-key=customers-settings-sla]",
	wide: true,
	steps: [{ click: 'button[aria-label="Edit Enterprise"] >> visible=true' }],
} satisfies ComparePage
