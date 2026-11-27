import type { ComparePage } from "../compare-entry"

/** `/hazel/notifications`: the inbox's Mentions tab, the shared Activity screen mounted by the page. */
export default {
	flag: "hazel:native:NotificationsMentions",
	tab: "Activity",
	href: "/hazel/notifications",
	island: '[data-hz-key="notifications"]',
	wide: true,
	// The island's parent is a host element with no box of its own.
	region: "viewport",
	steps: [],
} satisfies ComparePage
