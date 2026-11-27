import type { ComparePage } from "../compare-entry"

/** Channel settings, Connect: the share dialog, opened from the header's "Share channel". */
export default {
	flag: "hazel:native:ChannelSettingsConnect",
	href: "/hazel/channels/00000005-0000-4000-8000-000000000001/settings/connect",
	island: "[data-hz-key=channel-settings-connect]",
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: "text=Not shared yet >> visible=true" },
		{ click: "text=Share channel >> visible=true" },
		{ waitFor: "text=Allow guests to add members >> visible=true" },
	],
} satisfies ComparePage
