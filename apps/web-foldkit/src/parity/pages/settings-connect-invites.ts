import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/connect-invites`: two pending invites (Decline and Accept) over a declined one. */
export default {
	flag: "hazel:native:SettingsConnectInvites",
	href: "/hazel/settings/connect-invites",
	island: "[data-hz-key=connect-invites-page]",
	wide: true,
	steps: [{ waitFor: "text=Declined >> visible=true" }],
} satisfies ComparePage
