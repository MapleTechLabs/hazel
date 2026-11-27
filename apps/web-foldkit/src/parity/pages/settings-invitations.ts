import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/invitations`: three pending invitations (`apps/ios-hybrid/fixture/pages/settings-invitations.ts`). */
export default {
	flag: "hazel:native:SettingsInvitations",
	href: "/hazel/settings/invitations",
	island: '[data-hz-key="invitations"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
