import type { ComparePage } from "../compare-entry"

/** `/hazel/profile/<grace>`: another member's profile (online, an admin). */
export default {
	flag: "hazel:native:Profile",
	href: "/hazel/profile/00000002-0000-4000-8000-000000000002",
	island: '[data-hz-key="profile"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
