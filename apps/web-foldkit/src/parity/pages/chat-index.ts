import type { ComparePage } from "../compare-entry"

/** `/hazel/chat`, the Public tab, wide; a phone shows the shell's channel list on both sides. */
export default {
	flag: "hazel:native:ChatIndex",
	tab: "Home",
	href: "/hazel/chat",
	island: "[data-hz-key=chat-index], main[data-slot=sidebar]",
	wide: true,
	steps: [],
} satisfies ComparePage
