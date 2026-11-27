import type { ComparePage } from "../compare-entry"

/** `/auth/continue` without a provider: start again. */
export default {
	flag: "hazel:native:AuthContinue",
	href: "/auth/continue",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
