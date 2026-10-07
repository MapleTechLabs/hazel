import {
	ChannelWebhookListResponse,
	ChatSyncChannelLinkListResponse,
	GitHubSubscriptionListResponse,
	RssSubscriptionListResponse,
} from "@hazel/domain/rpc"
import { defaultIds } from "../fixtures/datasets/default.ts"
import { org, type AreaModule, type Scenario } from "./types.ts"

const s = (scenario: Omit<Scenario, "area">): Scenario => ({ area: "settings", ...scenario })
const integrations = `${org}/settings/integrations`
const channelIntegrations = `${org}/channels/${defaultIds.channel("general")}/settings/integrations`

const integrationDetail: Scenario[] = [
	s({ id: "settings-integration-linear", title: "Linear integration, not connected", path: `${integrations}/linear` }),
	s({ id: "settings-integration-linear-connected", title: "Linear integration, connected", path: `${integrations}/linear`, dataset: "integrations", themes: ["light", "dark"] }),
	s({
		id: "settings-integration-oauth-error",
		title: "Linear integration, OAuth callback failed",
		path: `${integrations}/linear?connection_status=error&error_code=token_exchange_failed`,
		steps: async (page) => {
			await page.getByText("Failed to connect to Linear").waitFor()
		},
	}),
	s({ id: "settings-integration-craft", title: "Craft integration, API key form", path: `${integrations}/craft` }),
]

const installed: Scenario[] = [
	s({ id: "settings-integrations-installed", title: "Installed apps", path: `${integrations}/installed`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-integrations-installed-empty", title: "Installed apps, none", path: `${integrations}/installed` }),
	s({
		id: "settings-integrations-install-by-id",
		title: "Installed apps, install by ID dialog",
		path: `${integrations}/installed`,
		steps: async (page) => {
			await page.getByRole("button", { name: "Install by ID" }).click()
			await page.getByRole("heading", { name: "Install Application by ID" }).waitFor()
		},
	}),
	s({
		id: "settings-integrations-install-by-id-error",
		title: "Installed apps, install by ID fails",
		path: `${integrations}/installed`,
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("button", { name: "Install by ID" }).click()
			await page.getByRole("textbox", { name: "Application ID" }).fill("00000000-0000-4000-8000-000000000000")
			await page.getByRole("button", { name: "Install", exact: true }).click()
		},
	}),
	s({
		id: "settings-integrations-uninstall-error",
		title: "Installed apps, uninstall fails",
		path: `${integrations}/installed`,
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("button", { name: "Uninstall" }).first().click()
			await page.getByText("Application not found").waitFor()
		},
	}),
]

const marketplace: Scenario[] = [
	s({ id: "settings-integrations-marketplace", title: "Marketplace", path: `${integrations}/marketplace`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-integrations-marketplace-empty", title: "Marketplace, no public apps", path: `${integrations}/marketplace` }),
	s({
		id: "settings-integrations-marketplace-search-empty",
		title: "Marketplace, search without results",
		path: `${integrations}/marketplace`,
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("textbox", { name: "Search applications..." }).fill("no such app")
			await page.getByText("Try a different search term").waitFor()
		},
	}),
	s({
		id: "settings-integrations-marketplace-install-error",
		title: "Marketplace, install fails",
		path: `${integrations}/marketplace`,
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("button", { name: "Install", exact: true }).first().click()
			await page.getByText("Already installed", { exact: true }).waitFor()
		},
	}),
]

const yourApps: Scenario[] = [
	s({ id: "settings-integrations-your-apps", title: "Your apps", path: `${integrations}/your-apps`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-integrations-your-apps-empty", title: "Your apps, none created", path: `${integrations}/your-apps` }),
	s({
		id: "settings-integrations-your-apps-menu",
		title: "Your apps, bot actions menu",
		path: `${integrations}/your-apps`,
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("button", { name: "Bot actions" }).first().click()
			await page.getByRole("menuitem", { name: "Regenerate Token" }).waitFor()
		},
	}),
	s({
		id: "settings-integrations-your-apps-delete",
		title: "Your apps, delete confirmation",
		path: `${integrations}/your-apps`,
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("button", { name: "Bot actions" }).first().click()
			await page.getByRole("menuitem", { name: "Delete" }).click()
			await page.getByRole("heading", { name: "Delete Application" }).waitFor()
		},
	}),
	s({
		id: "settings-integrations-your-apps-create",
		title: "Your apps, create application dialog",
		path: `${integrations}/your-apps`,
		steps: async (page) => {
			await page.getByRole("button", { name: "Create Application" }).first().click()
			await page.getByRole("heading", { name: "Create Application" }).waitFor()
		},
	}),
]

const channelIntegrationScenarios: Scenario[] = [
	s({ id: "channel-settings-integrations", title: "Channel integrations, no webhooks", path: channelIntegrations }),
	s({ id: "channel-settings-integrations-webhooks", title: "Channel integrations with webhooks", path: channelIntegrations, dataset: "integrations", themes: ["light", "dark"] }),
	s({
		id: "channel-settings-integrations-error",
		title: "Channel integrations, webhooks fail to load",
		path: channelIntegrations,
		dataset: "errors",
		steps: async (page) => {
			await page.getByText("Channel not found").waitFor()
		},
	}),
]

export const integrationsArea: AreaModule = {
	scenarios: [
		{
			id: "settings-integrations",
			area: "settings",
			title: "Integrations",
			path: `${org}/settings/integrations`,
		},
		...integrationDetail,
		...installed,
		...marketplace,
		...yourApps,
		...channelIntegrationScenarios,
	],
	// Empty lists for every dataset; the `integrations` dataset overrides them with data.
	rpc: () => ({
		"channelWebhook.list": () => new ChannelWebhookListResponse({ data: [] }),
		"channelWebhook.listByOrganization": () => new ChannelWebhookListResponse({ data: [] }),
		"chatSync.channelLink.list": () => new ChatSyncChannelLinkListResponse({ data: [] }),
		"rssSubscription.list": () => new RssSubscriptionListResponse({ data: [] }),
		"githubSubscription.list": () => new GitHubSubscriptionListResponse({ data: [] }),
	}),
}
