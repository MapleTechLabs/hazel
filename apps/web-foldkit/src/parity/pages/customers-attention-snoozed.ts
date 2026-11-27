import type { ComparePage } from "../compare-entry"

/** Needs attention's Snoozed tab. */
export default {
	flag: "hazel:native:CustomersAttention",
	href: "/hazel/customers/attention",
	island: '[data-hz-key="customers-attention"]',
	wide: true,
	steps: [{ waitFor: "text=Kestrel Analytics >> visible=true" }, { click: "text=Snoozed >> visible=true" }],
} satisfies ComparePage
