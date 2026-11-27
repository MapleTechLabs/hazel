import type { ComparePage } from "../compare-entry"

/** The channel's Files tab in the offline fixture's #general (`generalChannelId`), seeded with files. */
export default {
	flag: "hazel:native:ChatFiles",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001/files",
	island: '[data-hazel-hole="channel-files"] > div',
	wide: true,
	steps: [{ waitFor: "text=roadmap-q1.pdf" }],
} satisfies ComparePage
