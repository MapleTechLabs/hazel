import type { ComparePage } from "../compare-entry"

/** `/onboarding?step=profileInfo`: the profile step, its names seeded from `user.me`. */
export default {
	flag: "hazel:native:Onboarding",
	href: "/onboarding?step=profileInfo",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [{ waitFor: 'text="Set up your profile" >> visible=true' }],
} satisfies ComparePage
