import type { ComparePage } from "../compare-entry"

/** `/sign-in`: every method, as when the install can't list them (offline). */
export default {
	flag: "hazel:native:SignIn",
	href: "/sign-in",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
