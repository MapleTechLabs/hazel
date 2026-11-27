import type { ComparePage } from "../compare-entry"

/** `/hazel/chat`, the Private tab (the fixture's #leadership). */
export default {
	flag: "hazel:native:ChatIndex",
	tab: "Home",
	href: "/hazel/chat",
	island: "[data-hz-key=chat-index], main[data-slot=sidebar]",
	wide: true,
	steps: [{ at: "regular", click: '[role=tab]:has-text("Private"):visible' }],
} satisfies ComparePage
