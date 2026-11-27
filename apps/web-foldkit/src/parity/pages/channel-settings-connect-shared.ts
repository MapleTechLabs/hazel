import type { ComparePage } from "../compare-entry"

/** Channel settings, Connect, for #general shared with Acme Corp, with two outgoing invitations. */
export default {
	flag: "hazel:native:ChannelSettingsConnect",
	href: "/hazel/channels/00000005-0000-4000-8000-000000000001/settings/connect",
	island: "[data-hz-key=channel-settings-connect]",
	wide: true,
	region: "viewport",
	steps: [{ waitFor: "text=globex >> visible=true" }],
} satisfies ComparePage
