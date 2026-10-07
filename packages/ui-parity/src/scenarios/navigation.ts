import type { Page } from "playwright"
import { chat, type AreaModule, type Scenario } from "./types.ts"

const nav = (scenario: Omit<Scenario, "area" | "path"> & { path?: string }): Scenario => ({
	area: "navigation",
	...scenario,
	path: scenario.path ?? chat("general"),
})

const openPalette = async (page: Page) => {
	await page.getByText("Browse channels").first().click()
	await page.getByRole("dialog", { name: "Command Menu" }).waitFor()
}

/** Opens the command palette and follows one of its items to a sub-page. */
const palettePage = (item: string) => async (page: Page) => {
	await openPalette(page)
	await page.getByRole("menuitem", { name: item }).click()
}

/**
 * The sidebar section "+" buttons are named "badge 13" (the plus icon's <title>), in section order:
 * Channels, Projects, Direct Messages. Index into them until legacy gives them real labels.
 */
const sectionAddButton = (page: Page, index: number) =>
	page.getByRole("button", { name: "badge 13", exact: true }).nth(index)

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
		nav({
			id: "nav-palette-search",
			title: "Command palette: search messages page",
			themes: ["light", "dark"],
			steps: palettePage("Search messages"),
		}),
		nav({
			id: "nav-palette-create-channel",
			title: "Command palette: create channel page",
			steps: palettePage("Create channel"),
		}),
		nav({
			id: "nav-palette-join-channel",
			title: "Command palette: join channel page",
			steps: palettePage("Join channel"),
		}),
		nav({
			id: "nav-palette-status",
			title: "Command palette: set status page",
			steps: palettePage("Set status..."),
		}),
		nav({
			id: "nav-palette-appearance",
			title: "Command palette: appearance page",
			themes: ["light", "dark"],
			steps: palettePage("Change appearance..."),
		}),
		nav({
			id: "nav-channel-menu",
			title: "Sidebar channel actions menu",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("row", { name: "general" }).getByRole("button", { name: "dots" }).click()
				await page.getByRole("menu").waitFor()
			},
		}),
		nav({
			id: "nav-section-add-menu",
			title: "Channels section add menu",
			steps: async (page) => {
				await sectionAddButton(page, 0).click()
				await page.getByRole("menu").waitFor()
			},
		}),
		nav({
			id: "nav-create-channel-modal",
			title: "Create channel modal",
			themes: ["light", "dark"],
			steps: async (page) => {
				await sectionAddButton(page, 0).click()
				await page.getByRole("menuitem", { name: "Create new channel" }).click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		nav({
			id: "nav-join-channel-modal",
			title: "Join channel modal",
			steps: async (page) => {
				await sectionAddButton(page, 0).click()
				await page.getByRole("menuitem", { name: "Join existing channel" }).click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		nav({
			id: "nav-new-dm-modal",
			title: "New direct message modal",
			themes: ["light", "dark"],
			steps: async (page) => {
				await sectionAddButton(page, 2).click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		nav({
			id: "nav-mobile-sidebar",
			title: "Mobile: sidebar sheet opened from the channel header",
			viewports: ["mobile"],
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("main").getByRole("button", { name: "menu", exact: true }).click()
				await page.getByRole("dialog").waitFor()
			},
		}),
		nav({
			id: "nav-mobile-menu",
			title: "Mobile: sidebar sheet opened from the bottom navigation",
			viewports: ["mobile"],
			steps: async (page) => {
				await page.getByRole("navigation").getByRole("button", { name: "menu Menu" }).click()
				await page.getByRole("dialog").waitFor()
			},
		}),
	],
}
