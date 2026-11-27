import type { ComparePage } from "../compare-entry"

/** Channel settings, Overview, for #general: the icon and name form, and "Link to customer". */
export default {
	flag: "hazel:native:ChannelSettingsOverview",
	href: "/hazel/channels/00000005-0000-4000-8000-000000000001/settings/overview",
	island: "[data-hz-key=channel-settings-overview]",
	wide: true,
	region: "viewport",
	steps: [{ waitFor: "text=Link to customer >> visible=true" }],
} satisfies ComparePage
