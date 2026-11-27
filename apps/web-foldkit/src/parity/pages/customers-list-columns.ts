import type { ComparePage } from "../compare-entry"

/** PK4a: the list's column picker, opened from Columns. */
export default {
	flag: "hazel:native:CustomersList",
	href: "/hazel/customers/list",
	island: '[data-hazel-hole="customers-list-controls"]',
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: "text=Hooli" },
		{ click: 'button:has-text("Columns")' },
		{ waitFor: "text=Always shown" },
	],
} satisfies ComparePage
