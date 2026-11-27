import type { ComparePage } from "../compare-entry"

/** `/auth/register` without the callback's details: the broken link. */
export default {
	flag: "hazel:native:AuthRegister",
	href: "/auth/register",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
