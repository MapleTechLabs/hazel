import type { ComparePage } from "../compare-entry"

/** Customers: the native customers sidebar (rows, counts, the views to reorder) docked beside the rail (PH2; the Foldkit sidebar is deleted, so compare it in baseline mode). */
export default {
	flag: "hazel:native:layout:customers",
	href: "/hazel/customers",
	island: '[data-slot="sidebar-container"]',
	wide: true,
	// The offline customers source answers (refused, so empty) about 1.4s in: wait for it, or the views race the shot.
	steps: [{ waitFor: "text=Connect a data source" }],
} satisfies ComparePage
