import type { ComparePage } from "../compare-entry"

/** #general's notification control, its menu open. */
export default {
	flag: "hazel:native:ChatChannel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="channel-header"]',
	wide: true,
	region: "viewport",
	steps: [{ click: '[aria-label^="Notification settings"]' }],
} satisfies ComparePage
