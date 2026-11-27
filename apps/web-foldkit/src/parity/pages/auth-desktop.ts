import type { ComparePage } from "../compare-entry"

/** `/auth/desktop` opened without an attempt. */
export default {
	flag: "hazel:native:AuthDesktop",
	href: "/auth/desktop",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
