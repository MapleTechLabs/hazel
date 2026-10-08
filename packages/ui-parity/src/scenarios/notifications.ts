import { org, type AreaModule, type Scenario } from "./types.ts"

const inbox = `${org}/notifications`

/** The inbox and its three category tabs. Datasets are registered by the my-settings area. */
const tab = (key: "dms" | "general" | "threads", title: string): Scenario[] => [
	{
		id: `notifications-${key}`,
		area: "notifications",
		title: `${title} notifications`,
		path: `${inbox}/${key}`,
		dataset: "inbox",
		themes: ["light", "dark"],
	},
	{
		id: `notifications-${key}-empty`,
		area: "notifications",
		title: `${title} notifications, empty`,
		path: `${inbox}/${key}`,
	},
	{
		id: `notifications-${key}-mobile`,
		area: "notifications",
		title: `${title} notifications on mobile`,
		path: `${inbox}/${key}`,
		dataset: "inbox",
		viewports: ["mobile"],
	},
]

export const notificationsArea: AreaModule = {
	scenarios: [
		{ id: "notifications", area: "notifications", title: "Notifications inbox", path: inbox },
		{
			id: "notifications-all",
			area: "notifications",
			title: "Notifications inbox, read and unread across every time group",
			path: inbox,
			dataset: "inbox",
			viewports: ["desktop", "mobile"],
			themes: ["light", "dark"],
		},
		{
			id: "notifications-all-scrolled",
			area: "notifications",
			title: "Notifications inbox scrolled to older notifications",
			path: inbox,
			dataset: "inbox",
			steps: async (page) => {
				await page.getByRole("heading", { name: "Older" }).scrollIntoViewIfNeeded()
			},
		},
		{
			id: "notifications-all-hover",
			area: "notifications",
			title: "Hovered notification row",
			path: inbox,
			dataset: "inbox",
			steps: async (page) => {
				await page.getByText("Do you have ten minutes before the planning call?").hover()
			},
		},
		...tab("dms", "Direct message"),
		...tab("general", "Channel"),
		...tab("threads", "Thread"),
	],
}
