import type { ComparePage } from "../compare-entry"

/** `/hazel/chat`, the Direct messages tab (the fixture's DM with Grace). */
export default {
	flag: "hazel:native:ChatIndex",
	tab: "Home",
	href: "/hazel/chat",
	island: "[data-hz-key=chat-index], main[data-slot=sidebar]",
	wide: true,
	steps: [{ at: "regular", click: '[role=tab]:has-text("Direct messages"):visible' }],
} satisfies ComparePage
