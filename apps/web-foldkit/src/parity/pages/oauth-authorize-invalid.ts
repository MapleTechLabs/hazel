import type { ComparePage } from "../compare-entry"

/** `/oauth/authorize`: opened without its parameters. */
export default {
	flag: "hazel:native:OAuthAuthorize",
	href: "/oauth/authorize",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
