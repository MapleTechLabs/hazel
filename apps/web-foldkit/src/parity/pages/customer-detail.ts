import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/<Northwind>`: the native shell (PK5) around today's overview tab (`customer-detail` fixture). */
export default {
	flag: "hazel:native:CustomerDetail",
	href: "/hazel/customers/000000c1-0000-4000-8000-000000000002",
	island: "[data-hz-key=customer]",
	wide: true,
	steps: [{ waitFor: "text=Renewal call booked" }],
} satisfies ComparePage
