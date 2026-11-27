import type { ComparePage } from "../compare-entry"

/** Needs attention's Done tab: muted, or resolved in the last week. */
export default {
	flag: "hazel:native:CustomersAttention",
	href: "/hazel/customers/attention",
	island: '[data-hz-key="customers-attention"]',
	wide: true,
	steps: [{ waitFor: "text=Kestrel Analytics >> visible=true" }, { click: "text=Done >> visible=true" }],
} satisfies ComparePage
