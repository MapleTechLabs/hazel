import type { ComparePage } from "../compare-entry"

/** `/hazel/customers/support`: the Support report for the last 30 days (tiles, chart, tables). */
export default {
	flag: "hazel:native:CustomersSupportReport",
	href: "/hazel/customers/support",
	island: '[data-native-page="customers-support"]',
	wide: true,
	steps: [{ waitFor: "text=64 issues opened >> visible=true" }],
} satisfies ComparePage
