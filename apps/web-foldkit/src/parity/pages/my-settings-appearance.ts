import type { ComparePage } from "../compare-entry"

/** `/hazel/my-settings`: Appearance, the offline user's stored theme (the default preset). */
export default {
	flag: "hazel:native:MySettingsAppearance",
	href: "/hazel/my-settings",
	island: '[data-hz-key="my-settings-appearance"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
