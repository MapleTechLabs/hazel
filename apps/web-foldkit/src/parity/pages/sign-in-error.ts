import type { ComparePage } from "../compare-entry"

/** `/sign-in` after a refused OAuth callback (`?error=Denied`). */
export default {
	flag: "hazel:native:SignIn",
	href: "/sign-in?error=Denied",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
