import type { ComparePage } from "../compare-entry"

/** `/hazel/my-settings/desktop`: Desktop, for the offline user in Hazel Labs. */
export default {
	flag: "hazel:native:MySettingsDesktop",
	href: "/hazel/my-settings/desktop",
	island: '[data-hz-key="my-settings-desktop"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
