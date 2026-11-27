import type { ComparePage } from "../compare-entry"

/** `/sign-up`: the same methods, the account's copy. */
export default {
	flag: "hazel:native:SignUp",
	href: "/sign-up",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
