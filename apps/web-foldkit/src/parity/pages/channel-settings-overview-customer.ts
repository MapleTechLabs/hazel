import type { ComparePage } from "../compare-entry"

/** Channel settings, Overview, for #support, which is linked to Linear: the customer chip, Change and Unlink. */
export default {
	flag: "hazel:native:ChannelSettingsOverview",
	href: "/hazel/channels/00000005-0000-4000-8000-000000000003/settings/overview",
	island: "[data-hz-key=channel-settings-overview]",
	wide: true,
	region: "viewport",
	steps: [{ waitFor: "text=Unlink >> visible=true" }],
} satisfies ComparePage
