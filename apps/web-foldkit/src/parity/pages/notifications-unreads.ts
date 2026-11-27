import type { ComparePage } from "../compare-entry"

/** `/hazel/notifications/unreads`: the channels with messages Ada has not read, and "Mark all as read". */
export default {
	flag: "hazel:native:NotificationsUnreads",
	href: "/hazel/notifications/unreads",
	island: '[data-hz-key="notifications"]',
	wide: true,
	// The island's parent is a host element with no box of its own.
	region: "viewport",
	steps: [],
} satisfies ComparePage
