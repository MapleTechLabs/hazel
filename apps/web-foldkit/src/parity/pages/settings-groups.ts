import type { ComparePage } from "../compare-entry"

/** `/hazel/settings/groups` for the owner: the groups table, seeded with three groups. */
export default {
	flag: "hazel:native:SettingsGroups",
	href: "/hazel/settings/groups",
	island: "[data-hz-key=groups-page]",
	wide: true,
	steps: [{ waitFor: "text=@eng-leads >> visible=true" }],
} satisfies ComparePage
