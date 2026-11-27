import type { ComparePage } from "../compare-entry"

/** `/join/hazel`: the fixture org's public invite link, signed in. */
export default {
	flag: "hazel:native:Join",
	href: "/join/hazel",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
