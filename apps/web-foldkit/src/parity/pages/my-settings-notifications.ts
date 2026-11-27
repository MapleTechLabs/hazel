import type { ComparePage } from "../compare-entry"

/** `/hazel/my-settings/notifications`: Notifications, for the offline user in Hazel Labs. */
export default {
	flag: "hazel:native:MySettingsNotifications",
	href: "/hazel/my-settings/notifications",
	island: '[data-hz-key="my-settings-notifications"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
