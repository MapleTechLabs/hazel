import type { ComparePage } from "../compare-entry"

/** All media of the offline fixture's #general, seeded with three images. */
export default {
	flag: "hazel:native:ChatFilesMedia",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001/files/media",
	island: '[data-hazel-hole="channel-files"] > div',
	wide: true,
	steps: [{ waitFor: "text=All media" }],
} satisfies ComparePage
