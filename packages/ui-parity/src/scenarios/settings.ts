import { ChatSyncConnectionListResponse, ConnectInviteListResponse } from "@hazel/domain/rpc"
import { defaultIds } from "../fixtures/datasets/default.ts"
import { errorsDataset } from "../fixtures/datasets/errors.ts"
import { chatSyncIds } from "../fixtures/datasets/integrations-rpc.ts"
import { integrationsDataset, LONG_EMOJI_NAME, longChannelId } from "../fixtures/datasets/integrations.ts"
import { memberDataset, memberEmptyDataset } from "../fixtures/datasets/member.ts"
import { org, type AreaModule, type Scenario } from "./types.ts"

const channelSettings = (channelId: string, tab: string) => `${org}/channels/${channelId}/settings/${tab}`
const general = defaultIds.channel("general")
const design = defaultIds.channel("design")

const s = (scenario: Omit<Scenario, "area">): Scenario => ({ area: "settings", ...scenario })

const customEmojis: Scenario[] = [
	s({ id: "settings-custom-emojis", title: "Custom emojis, admin with emojis", path: `${org}/settings/custom-emojis`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-custom-emojis-empty", title: "Custom emojis, none uploaded", path: `${org}/settings/custom-emojis` }),
	s({
		id: "settings-custom-emojis-delete",
		title: "Custom emojis, delete confirmation",
		path: `${org}/settings/custom-emojis`,
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("row", { name: /:shipit:/ }).getByRole("button").click()
			await page.getByRole("heading", { name: "Delete custom emoji" }).waitFor()
		},
	}),
	s({
		id: "settings-custom-emojis-delete-error",
		title: "Custom emojis, delete fails",
		path: `${org}/settings/custom-emojis`,
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("row", { name: new RegExp(`:${LONG_EMOJI_NAME}:`) }).getByRole("button").click()
			await page.getByRole("button", { name: "Delete emoji" }).click()
			await page.getByText("Failed to delete emoji").waitFor()
		},
	}),
	s({ id: "settings-custom-emojis-member", title: "Custom emojis, member sees no admin controls", path: `${org}/settings/custom-emojis`, dataset: "member" }),
	s({ id: "settings-custom-emojis-member-empty", title: "Custom emojis, member empty state", path: `${org}/settings/custom-emojis`, dataset: "member-empty" }),
]

const connectInvites: Scenario[] = [
	s({ id: "settings-connect-invites", title: "Connect invitations, pending and declined", path: `${org}/settings/connect-invites`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-connect-invites-empty", title: "Connect invitations, none", path: `${org}/settings/connect-invites` }),
	s({
		id: "settings-connect-invites-accept-error",
		title: "Connect invitations, accepting fails",
		path: `${org}/settings/connect-invites`,
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("row", { name: /Acme Corporation/ }).getByRole("button", { name: "Accept" }).click()
			await page.getByText("Cannot accept").waitFor()
		},
	}),
]

const chatSync: Scenario[] = [
	s({ id: "settings-chat-sync", title: "Chat sync, active, paused and failing connections", path: `${org}/settings/chat-sync`, dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-chat-sync-empty", title: "Chat sync, no connections", path: `${org}/settings/chat-sync` }),
	s({ id: "settings-chat-sync-error", title: "Chat sync, connections fail to load", path: `${org}/settings/chat-sync`, dataset: "errors" }),
	s({
		id: "settings-chat-sync-add-menu",
		title: "Chat sync, add connection menu",
		path: `${org}/settings/chat-sync`,
		steps: async (page) => {
			await page.getByRole("button", { name: "Add Third Party Connection" }).first().click()
			await page.getByRole("menuitem", { name: "Discord" }).waitFor()
		},
	}),
	s({
		id: "settings-chat-sync-delete",
		title: "Chat sync, delete connection confirmation",
		path: `${org}/settings/chat-sync`,
		dataset: "integrations",
		steps: async (page) => {
			// The trash icon's SVG <title> ("badge 13") is the button's accessible name; its `title` is ignored.
			await page.getByRole("button", { name: "badge 13", exact: true }).first().click()
			await page.getByRole("heading", { name: "Delete Connection" }).waitFor()
		},
	}),
]

const connection = (key: keyof typeof chatSyncIds) => `${org}/settings/chat-sync/${chatSyncIds[key]}`
const chatSyncConnection: Scenario[] = [
	s({ id: "settings-chat-sync-connection", title: "Chat sync connection with channel links", path: connection("community"), dataset: "integrations", themes: ["light", "dark"] }),
	s({ id: "settings-chat-sync-connection-not-found", title: "Chat sync connection, not found", path: connection("community") }),
	s({ id: "settings-chat-sync-connection-error-status", title: "Chat sync connection in error state, no links", path: connection("legacy"), dataset: "integrations" }),
	s({ id: "settings-chat-sync-connection-long-name", title: "Chat sync connection, paused with a long guild name", path: connection("friends"), dataset: "integrations" }),
	s({
		id: "settings-chat-sync-connection-link-menu",
		title: "Chat sync connection, channel link actions menu",
		path: connection("community"),
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("button", { name: "Channel link actions" }).first().click()
			await page.getByRole("menuitem", { name: "Remove link" }).waitFor()
		},
	}),
	s({
		id: "settings-chat-sync-connection-disconnect",
		title: "Chat sync connection, disconnect confirmation",
		path: connection("community"),
		dataset: "integrations",
		steps: async (page) => {
			await page.getByRole("button", { name: "Disconnect" }).click()
			await page.getByRole("heading", { name: "Disconnect from Discord" }).waitFor()
		},
	}),
]

const channelOverview: Scenario[] = [
	s({ id: "channel-settings-overview", title: "Channel settings overview", path: channelSettings(general, "overview"), themes: ["light", "dark"] }),
	s({
		id: "channel-settings-overview-invalid",
		title: "Channel settings overview, empty name",
		path: channelSettings(general, "overview"),
		steps: async (page) => {
			await page.getByRole("textbox", { name: "Channel name" }).fill("")
		},
	}),
	s({ id: "channel-settings-overview-long-name", title: "Channel settings overview, long channel name", path: channelSettings(longChannelId, "overview"), dataset: "integrations" }),
	s({
		id: "channel-settings-overview-save-error",
		title: "Channel settings overview, saving fails",
		path: channelSettings(general, "overview"),
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("textbox", { name: "Channel name" }).fill("general-renamed")
			await page.getByRole("button", { name: "Save changes" }).click()
			await page.getByText("Channel not found").waitFor()
		},
	}),
]

const channelConnect: Scenario[] = [
	s({ id: "channel-settings-connect", title: "Channel connect, not shared", path: channelSettings(general, "connect") }),
	s({ id: "channel-settings-connect-shared", title: "Channel connect, shared with invitations", path: channelSettings(design, "connect"), dataset: "integrations", themes: ["light", "dark"] }),
	s({
		id: "channel-settings-connect-share-modal",
		title: "Channel connect, share channel dialog",
		path: channelSettings(general, "connect"),
		steps: async (page) => {
			await page.getByRole("button", { name: "Share channel" }).first().click()
			await page.getByRole("heading", { name: "Share #general" }).waitFor()
		},
	}),
	s({
		id: "channel-settings-connect-revoke-error",
		title: "Channel connect, revoking an invite fails",
		path: channelSettings(design, "connect"),
		dataset: "errors",
		steps: async (page) => {
			await page.getByRole("button", { name: "Revoke" }).click()
			await page.getByText("Invite not found").waitFor()
		},
	}),
]

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
		...customEmojis,
		// Production builds redirect /settings/debug to /settings, so this captures the redirect.
		s({ id: "settings-debug", title: "Debug tools (redirects in production builds)", path: `${org}/settings/debug` }),
		...connectInvites,
		...chatSync,
		...chatSyncConnection,
		...channelOverview,
		...channelConnect,
	],
	datasets: [integrationsDataset, memberDataset, memberEmptyDataset, errorsDataset],
	rpc: () => ({
		// The built-in handler returns a plain object, which fails to encode as the response class.
		"chatSync.connection.list": () => new ChatSyncConnectionListResponse({ data: [] }),
		"connectShare.invite.listIncoming": () => new ConnectInviteListResponse({ data: [] }),
		"connectShare.invite.listOutgoing": () => new ConnectInviteListResponse({ data: [] }),
	}),
}
