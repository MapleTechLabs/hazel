import { defaultIds } from "../fixtures/datasets/default.ts"
import { org, type AreaModule } from "./types.ts"

/** Organization settings and channel settings. */
export const settingsArea: AreaModule = {
	scenarios: [
		{ id: "settings-general", area: "settings", title: "Organization settings", path: `${org}/settings` },
		{
			id: "settings-team",
			area: "settings",
			title: "Team members",
			path: `${org}/settings/team`,
			themes: ["light", "dark"],
		},
		{
			id: "settings-invitations",
			area: "settings",
			title: "Invitations",
			path: `${org}/settings/invitations`,
		},
		{
			id: "channel-settings",
			area: "settings",
			title: "Channel settings",
			path: `${org}/channels/${defaultIds.channel("general")}/settings`,
		},
	],
}
