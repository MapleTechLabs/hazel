import type { Page } from "playwright"
import type { Dataset } from "./fixtures/dataset.ts"
import { defaultDataset, defaultIds } from "./fixtures/datasets/default.ts"

/**
 * A scenario is one screen state, captured identically in both apps.
 *
 * Steps drive the page with accessible locators (`getByRole`, `getByText`), never
 * CSS selectors or test IDs, so the same script runs against the React app and
 * the Foldkit app. If a step cannot find its element in one app, that is itself a
 * parity failure (wrong role, missing label) and is reported as such.
 */
export interface Scenario {
	readonly id: string
	readonly title: string
	readonly path: string
	readonly dataset?: string
	readonly viewports?: ReadonlyArray<ViewportName>
	readonly themes?: ReadonlyArray<ThemeName>
	readonly steps?: (page: Page) => Promise<void>
	/** Elements whose pixels are excluded from the diff (e.g. a live clock). Accessible locators only. */
	readonly mask?: (page: Page) => ReadonlyArray<ReturnType<Page["locator"]>>
	/** Capture the full scroll height instead of the viewport. */
	readonly fullPage?: boolean
	/** Tag for grouping in the report and for `--filter`. */
	readonly area: string
}

export const viewports = {
	desktop: { width: 1440, height: 900 },
	laptop: { width: 1280, height: 800 },
	mobile: { width: 390, height: 844 },
} as const
export type ViewportName = keyof typeof viewports

export type ThemeName = "light" | "dark"

export const datasets: ReadonlyMap<string, Dataset> = new Map([[defaultDataset.name, defaultDataset]])

const org = `/${defaultIds.orgSlug}`
const chat = (key: Parameters<typeof defaultIds.channel>[0]) => `${org}/chat/${defaultIds.channel(key)}`

export const scenarios: ReadonlyArray<Scenario> = [
	// Chat
	{
		id: "chat-channel",
		area: "chat",
		title: "Channel with messages, reactions and markdown",
		path: chat("general"),
		viewports: ["desktop", "mobile"],
		themes: ["light", "dark"],
	},
	{ id: "chat-channel-empty", area: "chat", title: "Channel with no messages", path: chat("random") },
	{ id: "chat-private-channel", area: "chat", title: "Private channel", path: chat("leadership") },
	{ id: "chat-dm", area: "chat", title: "Direct message", path: chat("dm-grace") },
	{
		id: "chat-message-hover",
		area: "chat",
		title: "Hovered message shows its action toolbar",
		path: chat("general"),
		steps: async (page) => {
			await page.getByText("Shipped the new onboarding copy").hover()
		},
	},
	{
		id: "chat-composer-focused",
		area: "chat",
		title: "Composer focused with draft text",
		path: chat("general"),
		steps: async (page) => {
			// The composer is a combobox (mention autocomplete) with no accessible name yet.
			await page.getByRole("combobox").last().click()
			await page.keyboard.type("Draft reply with **bold** text")
		},
	},
	{
		id: "chat-files-tab",
		area: "chat",
		title: "Channel files tab",
		path: `${chat("general")}/files`,
	},

	// Navigation & overlays
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

	// Notifications
	{
		id: "notifications",
		area: "notifications",
		title: "Notifications inbox",
		path: `${org}/notifications`,
	},

	// Settings
	{ id: "settings-general", area: "settings", title: "Organization settings", path: `${org}/settings` },
	{ id: "settings-team", area: "settings", title: "Team members", path: `${org}/settings/team` },
	{
		id: "settings-invitations",
		area: "settings",
		title: "Invitations",
		path: `${org}/settings/invitations`,
	},
	{
		id: "settings-integrations",
		area: "settings",
		title: "Integrations",
		path: `${org}/settings/integrations`,
	},
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
	{
		id: "channel-settings",
		area: "settings",
		title: "Channel settings",
		path: `${org}/channels/${defaultIds.channel("general")}/settings`,
	},
]
