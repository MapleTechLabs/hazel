import type { ComparePage } from "../compare-entry"

/**
 * PK4a: `/hazel/customers/list`, the list's controls and table (hazel, in the Foldkit page's
 * holes) over the page fixture's accounts. The page around them is still Foldkit (PK4b).
 */
export default {
	flag: "hazel:native:CustomersList",
	href: "/hazel/customers/list",
	island: '[data-hazel-hole="customers-list-table"] [data-hz="table"]',
	wide: true,
	region: "viewport",
	// The table draws once the accounts sync and the drawn rows' sparklines answer.
	steps: [{ waitFor: "text=Hooli" }],
} satisfies ComparePage
