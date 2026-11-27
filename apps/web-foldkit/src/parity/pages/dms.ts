import type { ComparePage } from "../compare-entry"

/** The phase 3 DMs tab island (`islands/dms.ts`), phone only. */
export default {
	flag: "hazel:island:dms",
	tab: "DMs",
	href: "/hazel/chat/dms",
	island: '[data-island="dms"]',
	wide: false,
	steps: [],
} satisfies ComparePage
