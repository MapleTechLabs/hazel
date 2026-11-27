import type { ComparePage } from "../compare-entry"

/** `/hazel/notifications/all`: every notification of the member. */
export default {
	flag: "hazel:native:NotificationsAll",
	href: "/hazel/notifications/all",
	island: '[data-hz-key="notifications"]',
	wide: true,
	// The island's parent is a host element with no box of its own.
	region: "viewport",
	steps: [],
} satisfies ComparePage
