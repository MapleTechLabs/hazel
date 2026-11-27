import type { ComparePage } from "../compare-entry"

/** The phase 3 DMs tab screen, phone only. (no flag since the shell; compare it in baseline mode). */
export default {
	flag: "hazel:island:dms",
	tab: "DMs",
	href: "/hazel/chat/dms",
	island: '[data-island="dms"]',
	wide: false,
	steps: [],
} satisfies ComparePage
