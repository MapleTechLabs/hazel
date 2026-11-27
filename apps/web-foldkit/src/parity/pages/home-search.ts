import type { ComparePage } from "../compare-entry"

/** `/hazel` searched for "marg": only Margaret Hamilton is left. */
export default {
	flag: "hazel:native:OrgHome",
	href: "/hazel",
	island: '[data-hz-key="home"]',
	wide: true,
	region: "viewport",
	steps: [{ fill: "main input:visible", text: "marg" }],
} satisfies ComparePage
