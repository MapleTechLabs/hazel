import type { ComparePage } from "../compare-entry"

/** The phase 3 message list screen in the offline fixture's #general (no flag since the shell, so compare it in baseline mode). */
export default {
	flag: "hazel:island:channel",
	// `generalChannelId` in `apps/ios-hybrid/fixture/snapshot.ts`.
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-island="channel"]',
	wide: true,
	steps: [],
} satisfies ComparePage
