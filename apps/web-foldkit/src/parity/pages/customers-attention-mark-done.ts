import type { ComparePage } from "../compare-entry"

/** The mark-done dialog, from the first signal's preview. */
export default {
	flag: "hazel:native:CustomersAttention",
	href: "/hazel/customers/attention",
	island: '[data-hz-key="customers-attention"]',
	wide: true,
	steps: [
		{ waitFor: "text=Kestrel Analytics >> visible=true" },
		{ click: "text=Payment failed >> visible=true" },
		{ click: 'button:not([role=tab]):has-text("Done") >> visible=true' },
		{ waitFor: "text=Mark signal as done >> visible=true" },
	],
	region: "viewport",
} satisfies ComparePage
