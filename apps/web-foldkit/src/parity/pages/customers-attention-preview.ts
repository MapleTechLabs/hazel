import type { ComparePage } from "../compare-entry"

/** Needs attention with the first signal's preview open (its account detail by RPC). */
export default {
	flag: "hazel:native:CustomersAttention",
	href: "/hazel/customers/attention",
	island: '[data-hz-key="customers-attention"]',
	wide: true,
	steps: [
		{ waitFor: "text=Kestrel Analytics >> visible=true" },
		{ click: "text=Payment failed >> visible=true" },
		{ waitFor: "text=Contacts to reach >> visible=true" },
	],
} satisfies ComparePage
