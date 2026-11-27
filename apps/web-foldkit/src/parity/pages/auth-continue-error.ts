import type { ComparePage } from "../compare-entry"

/** `/auth/continue?provider=github`: the sign-in it starts fails offline. */
export default {
	flag: "hazel:native:AuthContinue",
	href: "/auth/continue?provider=github",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
