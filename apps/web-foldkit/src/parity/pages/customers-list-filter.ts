import type { ComparePage } from "../compare-entry"

/** PK4a: the list's filter builder, opened from `+ Filter` on its first field (Stage). */
export default {
	flag: "hazel:native:CustomersList",
	href: "/hazel/customers/list",
	island: '[data-hazel-hole="customers-list-controls"]',
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: "text=Hooli" },
		{ click: 'button:has-text("Filter") >> nth=0' },
		{ waitFor: "text=Apply filter" },
	],
} satisfies ComparePage
