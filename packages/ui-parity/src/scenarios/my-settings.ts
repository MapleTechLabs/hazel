import { org, type AreaModule } from "./types.ts"

export const mySettingsArea: AreaModule = {
	scenarios: [
		{
			id: "my-settings-profile",
			area: "settings",
			title: "Profile settings",
			path: `${org}/my-settings/profile`,
		},
		{
			id: "my-settings-notifications",
			area: "settings",
			title: "Notification preferences",
			path: `${org}/my-settings/notifications`,
		},
	],
}
