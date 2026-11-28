import type { ComparePage } from "../compare-entry"

/** `/hazel/settings`: the owner's view, every card, with two exports (`apps/ios/fixture/pages/settings-general.ts`). */
export default {
	flag: "hazel:native:SettingsGeneral",
	href: "/hazel/settings",
	island: '[data-hz-key="general"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
