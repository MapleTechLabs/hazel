import type { ComparePage } from "../compare-entry"

/** Notifications: Activity's native sidebar around Mentions (PH1; the Foldkit layout is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:activity",
	href: "/hazel/notifications",
	island: '[data-section-layout="activity"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
