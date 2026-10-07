import { org, type AreaModule } from "./types.ts"

export const notificationsArea: AreaModule = {
	scenarios: [
		{
			id: "notifications",
			area: "notifications",
			title: "Notifications inbox",
			path: `${org}/notifications`,
		},
	],
}
