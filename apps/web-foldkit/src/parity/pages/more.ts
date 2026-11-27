import type { ComparePage } from "../compare-entry"

/** `/hazel/more`: a phone's More tab (who you are, the workspace, your settings). */
export default {
	flag: "hazel:native:OrgMore",
	tab: "More",
	href: "/hazel/more",
	island: '[data-hz-key="more"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
