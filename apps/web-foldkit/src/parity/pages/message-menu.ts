import type { ComparePage } from "../compare-entry"

/** PC4: the message menu (quick reactions and the More entries) opened from the keyboard on Ada's row. */
export default {
	flag: "hazel:native:ChatChannel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	// A click focuses the row; Shift+F10 opens the menu a right click opens, at the row.
	// Wait for the row first: a hover or click while the list still settles scrolls it elsewhere.
	steps: [
		{ waitFor: '[data-hz=message]:has-text("Shipping it.")' },

		{ click: '[data-hz=message]:has-text("Shipping it.") [data-hz-part=text]' },
		{ press: "Shift+F10" },
		{ waitFor: "[data-hz=contextMenu] [role=menu]:visible" },
	],
	region: "viewport",
} satisfies ComparePage
