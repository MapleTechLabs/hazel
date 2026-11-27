import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/team`: the fixture's six members with their presence and roles. */
export default {
	flag: "hazel:native:TeamSettings",
	href: "/hazel/settings/team",
	island: '[data-hz-key="team"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
