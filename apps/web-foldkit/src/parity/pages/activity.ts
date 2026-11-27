import type { ComparePage } from "../compare-entry"

/** The phase 3 Activity screen. (no flag since the shell; compare it in baseline mode). */
export default {
	flag: "hazel:island:activity",
	tab: "Activity",
	href: "/hazel/notifications",
	island: '[data-island="activity"]',
	wide: true,
	steps: [],
} satisfies ComparePage
