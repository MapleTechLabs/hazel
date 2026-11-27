import type { ComparePage } from "../compare-entry"

/** The phase 3 Activity island (`islands/activity.ts`). */
export default {
	flag: "hazel:island:activity",
	tab: "Activity",
	href: "/hazel/notifications",
	island: '[data-island="activity"]',
	wide: true,
	steps: [],
} satisfies ComparePage
