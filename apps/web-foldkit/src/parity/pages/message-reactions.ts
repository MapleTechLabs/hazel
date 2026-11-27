import type { ComparePage } from "../compare-entry"

/** PC4: the reaction row on "Shipping it." (🎉 by Grace and Katherine, ❤️ by Margaret), its first pill hovered. */
export default {
	flag: "hazel:native:ChatChannel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	// Wait for the row first: a hover or click while the list still settles scrolls it elsewhere.
	steps: [
		{ waitFor: '[data-hz=message]:has-text("Shipping it.")' },
		{ hover: '[data-hz=message]:has-text("Shipping it.") [data-hz-part=reaction]' },
	],
} satisfies ComparePage
