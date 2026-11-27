import type { ComparePage } from "../compare-entry"

/** `/onboarding`: the welcome step of the invited flow (Ada joined Hazel Labs), panel and counter. */
export default {
	flag: "hazel:native:Onboarding",
	href: "/onboarding",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [{ waitFor: "text=/Get started/ >> visible=true" }],
} satisfies ComparePage
