import type { ComparePage } from "../compare-entry"

/** The Signals list's New signal: the template picker over the page. */
export default {
	flag: "hazel:native:CustomersSettingsSignals",
	href: "/hazel/customers/settings/signals",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: "text=Payment failed >> visible=true" },
		{ click: 'button:visible:has-text("New signal")' },
	],
} satisfies ComparePage
