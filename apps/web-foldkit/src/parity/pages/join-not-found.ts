import type { ComparePage } from "../compare-entry"

/** `/join/nope`: a slug with no public workspace. */
export default {
	flag: "hazel:native:Join",
	href: "/join/nope",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
