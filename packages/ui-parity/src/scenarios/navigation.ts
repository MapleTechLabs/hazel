import { chat, type AreaModule } from "./types.ts"

export const navigationArea: AreaModule = {
	scenarios: [
		{
			id: "nav-user-menu",
			area: "navigation",
			title: "User menu open",
			path: chat("general"),
			steps: async (page) => {
				await page.getByRole("button", { name: "Profile" }).click()
			},
		},
		{
			id: "nav-org-switcher",
			area: "navigation",
			title: "Organization switcher open",
			path: chat("general"),
			steps: async (page) => {
				await page
					.getByRole("button", { name: /Hazel Labs/ })
					.first()
					.click()
			},
		},
		{
			id: "nav-command-palette",
			area: "navigation",
			title: "Command palette",
			path: chat("general"),
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByText("Browse channels").first().click()
			},
		},
	],
}
