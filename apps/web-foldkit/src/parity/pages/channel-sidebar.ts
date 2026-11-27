import type { ComparePage } from "../compare-entry"

/** The phase 3 channel list screen (no flag since the shell, so compare it in baseline mode). */
export default {
	flag: "hazel:island:channel-list",
	tab: "Home",
	href: "/hazel/chat",
	island: '[data-island="channel-list"]',
	wide: true,
	steps: [],
} satisfies ComparePage
