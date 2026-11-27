import type { ComparePage } from "../compare-entry"

/** `/auth/register`: the empty name form from an OAuth callback. */
export default {
	flag: "hazel:native:AuthRegister",
	href: "/auth/register?flowId=flow-1&reference=ref-1",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
