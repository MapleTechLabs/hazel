import type { ComparePage } from "../compare-entry"

/** Needs attention over the fixture's signals (`fixture/pages/customers-attention.ts`), Open tab. */
export default {
	flag: "hazel:native:CustomersAttention",
	href: "/hazel/customers/attention",
	island: '[data-hz-key="customers-attention"]',
	wide: true,
	steps: [{ waitFor: "text=Kestrel Analytics >> visible=true" }],
} satisfies ComparePage
