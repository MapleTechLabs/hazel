import type { ComparePage } from "../compare-entry"

/** `/auth/desktop?attempt=`: the attempt can't be described offline. */
export default {
	flag: "hazel:native:AuthDesktop",
	href: "/auth/desktop?attempt=attempt-1",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
