import type { ComparePage } from "../compare-entry"

/** `/hazel`: the member directory with each member's presence, Message and menu. */
export default {
	flag: "hazel:native:OrgHome",
	href: "/hazel",
	island: '[data-hz-key="home"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
