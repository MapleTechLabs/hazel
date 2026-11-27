import type { ComparePage } from "../compare-entry"

/**
 * #general ending in rich content (lane PC6, `apps/ios-hybrid/fixture/pages/chat-rich.ts`): a bot
 * card, a picture embed, an unfurled link, an HTML render and a pinned streaming reply. The list is
 * hazel since phase 3 (no flag), so it compares in baseline mode.
 */
export default {
	flag: "hazel:island:chat-rich",
	// `generalChannelId` in `apps/ios-hybrid/fixture/snapshot.ts`.
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	steps: [{ waitFor: "iframe[title='Weekly report']" }],
} satisfies ComparePage
