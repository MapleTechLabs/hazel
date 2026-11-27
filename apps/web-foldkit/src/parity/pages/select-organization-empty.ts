import type { ComparePage } from "../compare-entry"

/** `/select-organization` with no workspace: the create form. */
export default {
	flag: "hazel:native:SelectOrganization",
	href: "/select-organization",
	island: '[data-hz-key="select-organization"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
