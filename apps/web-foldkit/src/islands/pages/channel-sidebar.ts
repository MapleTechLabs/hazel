import type { ComparePage } from "../compare-entry"

/** The phase 3 channel list island (`islands/channel-list.ts`). */
export default {
	flag: "hazel:island:channel-list",
	tab: "Home",
	href: "/hazel/chat",
	island: '[data-island="channel-list"]',
	wide: true,
	steps: [],
} satisfies ComparePage
