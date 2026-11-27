import type { ComparePage } from "../compare-entry"

/** `/hazel/profile/<ada>`: your own profile, with "Edit profile". */
export default {
	flag: "hazel:native:Profile",
	href: "/hazel/profile/00000002-0000-4000-8000-000000000001",
	island: '[data-hz-key="profile"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
