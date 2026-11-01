// @vitest-environment jsdom
import { routeOfPath } from "../../../route"
import { ChannelId, ExternalChannelId, SyncChannelLinkId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import { successToast } from "../../../data/actions"
import { makeShared, organizationId, pageScene, portalModalMounted, uuid } from "../../../test/pages-fixtures"
import {
	connection,
	slackChannels,
	slackConnection,
	slackSyncConnectionId,
	syncConnectionId,
} from "../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { ExternalChannels } from "../chat-sync/providers"
import {
	CreateChannelLink,
	DisconnectConnection,
	ListChannelLinks,
	ListChatSyncConnectionsForConnection,
	ListExternalChannels,
	RemoveChannelLink,
} from "./command"
import { Message, type Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The connection page through its view: disconnecting, removing a link and linking a channel. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const step = (model: Model, message: Message) => update(model, message, shared).model
const route = {
	_tag: "SettingsChatSyncConnection",
	orgSlug: "hazel",
	connectionId: syncConnectionId,
} as const
const linkId = Schema.decodeSync(SyncChannelLinkId)(uuid(40))
const hazelChannel = { id: Schema.decodeSync(ChannelId)(uuid(41)), name: "engineering" }
const discordChannel = {
	id: Schema.decodeSync(ExternalChannelId)("918273645500777"),
	name: "dev-chat",
	isPrivate: false,
	isMember: true,
}
const link = {
	id: linkId,
	hazelChannelId: hazelChannel.id,
	externalName: "general",
	direction: "both" as const,
	isActive: true,
	webhookPermission: "allowed" as const,
}
const initial = init(route, shared).model
const found = [
	Message.SucceededListConnections({ organizationId, connections: [connection] }),
	Message.SucceededListExternalChannels({ workspaceId: "918273645500120", channels: [discordChannel] }),
	Message.UpdatedHazelChannels({ channels: [hazelChannel] }),
	Message.UpdatedChannelNames({ names: { [hazelChannel.id]: "engineering" } }),
].reduce(step, initial)
const withLink = step(found, Message.SucceededListChannelLinks({ version: 1, links: [link] }))
const withoutLinks = step(found, Message.SucceededListChannelLinks({ version: 1, links: [] }))

const dialog = Scene.role("dialog")
const tryAgain = Scene.role("button", { name: "Try again" })
const inDialog = (name: string | RegExp) => Scene.within(dialog, Scene.role("button", { name }))
/** Each link row's menu trigger focuses itself on press. */
const linkMenuMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
/** The add link modal is a controlled modal: its Mount result arrives already wrapped. */
const addLinkModalMounted = Scene.Mount.resolve(
	{ name: "AcquireResources" },
	Modal.Message.SucceededAcquireResources(),
)

describe("connection states", () => {
	test("a loading connection shows a spinner", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.text("Loading connection...")).toExist(),
			Scene.expect(Scene.text("Channel Links")).toBeAbsent(),
		)
	})

	test("a connection missing from the list offers a way back", () => {
		Scene.scene(
			config,
			Scene.given(step(initial, Message.SucceededListConnections({ organizationId, connections: [] }))),
			Scene.expect(Scene.text("Connection not found")).toExist(),
			Scene.click(Scene.role("button", { name: "Go back" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/chat-sync"),
					replace: false,
				}),
			),
		)
	})

	test("a failed connection list explains why, not 'not found', and Try again reloads it", () => {
		Scene.scene(
			config,
			Scene.given(step(initial, Message.FailedListConnections({ organizationId, reason: "Offline" }))),
			Scene.expect(Scene.text("Failed to load connection")).toExist(),
			Scene.expect(Scene.text("Check your internet connection and try again.")).toExist(),
			Scene.expect(Scene.text("Connection not found")).toBeAbsent(),
			Scene.click(tryAgain),
			Scene.Command.expectExact(ListChatSyncConnectionsForConnection({ organizationId })),
			Scene.expect(Scene.text("Loading connection...")).toExist(),
			Scene.Command.resolve(
				ListChatSyncConnectionsForConnection,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			),
			Scene.Command.resolve(
				ListExternalChannels,
				Message.SucceededListExternalChannels({
					workspaceId: connection.externalWorkspaceId,
					channels: [],
				}),
			),
			Scene.expect(Scene.text("Channel Links")).toExist(),
		)
	})

	test("failed channel links explain why, not 'no channels linked', and Try again reloads them", () => {
		Scene.scene(
			config,
			Scene.given(step(found, Message.FailedListChannelLinks({ version: 1, reason: "Unavailable" }))),
			Scene.expect(Scene.text("Failed to load channel links")).toExist(),
			Scene.expect(Scene.text("Please try again in a moment.")).toExist(),
			Scene.expect(Scene.text("No channels linked")).toBeAbsent(),
			Scene.click(tryAgain),
			Scene.Command.expectExact(ListChannelLinks({ syncConnectionId, version: 2 })),
			Scene.expect(Scene.text("Loading channel links...")).toExist(),
			Scene.Command.resolve(
				ListChannelLinks,
				Message.SucceededListChannelLinks({ version: 2, links: [link] }),
			),
			linkMenuMounted,
			Scene.expect(Scene.text("general")).toExist(),
		)
	})

	test("a linked channel shows its Hazel name, Discord name and status", () => {
		Scene.scene(
			config,
			Scene.given(withLink),
			linkMenuMounted,
			Scene.expect(Scene.text("engineering")).toExist(),
			Scene.expect(Scene.text("general")).toExist(),
			Scene.expect(Scene.text("Webhook")).toExist(),
			Scene.expect(Scene.role("button", { name: "Channel link actions" })).toExist(),
		)
	})
})

describe("disconnect", () => {
	test("confirming disconnects, toasts, then returns to the list", () => {
		Scene.scene(
			config,
			Scene.given(withoutLinks),
			Scene.click(Scene.role("button", { name: "Disconnect" })),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Hazel Community"))).toExist(),
			Scene.click(inDialog("Disconnect")),
			Scene.Command.expectExact(DisconnectConnection({ syncConnectionId })),
			Scene.expect(inDialog("Disconnecting...")).toBeDisabled(),
			Scene.Command.resolve(DisconnectConnection, Message.SucceededDisconnect()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/chat-sync"),
					replace: false,
					toast: successToast("Connection deleted"),
				}),
			),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
		)
	})

	test("a failed disconnect toasts the reason and keeps the dialog open to retry", () => {
		Scene.scene(
			config,
			Scene.given(withoutLinks),
			Scene.click(Scene.role("button", { name: "Disconnect" })),
			portalModalMounted,
			Scene.click(inDialog("Disconnect")),
			Scene.Command.resolve(DisconnectConnection, Message.FailedDisconnect({ reason: "Unexpected" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Something went wrong",
						description: "Please try again.",
					},
				}),
			),
			Scene.expect(inDialog("Disconnect")).toBeEnabled(),
		)
	})
})

describe("remove a channel link", () => {
	const confirming = {
		...withLink,
		removeLinkConfirm: ConfirmAction.ask(withLink.removeLinkConfirm, { id: linkId, name: "general" }),
	}

	test("confirming removes the link, toasts and refreshes the shown links", () => {
		Scene.scene(
			config,
			Scene.given(confirming),
			linkMenuMounted,
			portalModalMounted,
			Scene.click(inDialog("Remove Link")),
			Scene.Command.expectExact(RemoveChannelLink({ syncChannelLinkId: linkId })),
			Scene.expect(inDialog("Removing...")).toBeDisabled(),
			Scene.Command.resolve(RemoveChannelLink, Message.SucceededRemoveLink()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel link removed") }),
			),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.expect(Scene.text("Loading channel links...")).toBeAbsent(),
			Scene.expect(Scene.text("general")).toExist(),
			Scene.Command.resolve(
				ListChannelLinks,
				Message.SucceededListChannelLinks({ version: 2, links: [] }),
			),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.expect(Scene.text("No channels linked")).toExist(),
		)
	})

	test("a failed removal keeps the dialog open and re-enables Remove Link", () => {
		Scene.scene(
			config,
			Scene.given(confirming),
			linkMenuMounted,
			portalModalMounted,
			Scene.click(inDialog("Remove Link")),
			Scene.Command.resolve(RemoveChannelLink, Message.FailedRemoveLink({ reason: "Offline" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			Scene.expect(inDialog("Remove Link")).toBeEnabled(),
		)
	})
})

const linkButtonOf = () => inDialog("Link Channel")

describe("link a channel", () => {
	const linkButton = linkButtonOf()

	test("Link Channel enables once both channels are picked, then creates the link", () => {
		Scene.scene(
			config,
			Scene.given(withoutLinks),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.expect(linkButton).toBeDisabled(),
			Scene.type(Scene.placeholder("Search channels..."), "eng"),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: /engineering$/ }))),
			Scene.expect(linkButton).toBeDisabled(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: /dev-chat$/ }))),
			Scene.click(Scene.within(dialog, Scene.text("Discord to Hazel"))),
			Scene.expect(linkButton).toBeEnabled(),
			Scene.click(linkButton),
			Scene.Command.expectExact(
				CreateChannelLink({
					syncConnectionId,
					hazelChannelId: hazelChannel.id,
					hazelChannelName: "engineering",
					externalChannelId: discordChannel.id,
					externalChannelName: "dev-chat",
					direction: "external_to_hazel",
				}),
			),
			Scene.expect(inDialog("Linking...")).toBeDisabled(),
			Scene.Command.resolve(
				CreateChannelLink,
				Message.SucceededCreateLink({ successMessage: "Channel linked" }),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Channel linked") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.Command.resolve(
				ListChannelLinks,
				Message.SucceededListChannelLinks({ version: 2, links: [link] }),
			),
			linkMenuMounted,
			Scene.expect(Scene.text("general")).toExist(),
		)
	})

	test("a failed link keeps the picks and re-enables Link Channel", () => {
		Scene.scene(
			config,
			Scene.given({
				...withoutLinks,
				selectedChannel: hazelChannel,
				selectedExternalChannel: discordChannel,
			}),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.click(linkButton),
			Scene.Command.resolve(CreateChannelLink, Message.FailedCreateLink({ reason: "AlreadyLinked" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Link already exists",
						description: "This channel is already synced.",
					},
				}),
			),
			Scene.expect(Scene.within(dialog, Scene.text("dev-chat"))).toExist(),
			Scene.expect(linkButton).toBeEnabled(),
		)
	})

	test("Discord channels that fail to load explain why and keep Link Channel disabled", () => {
		Scene.scene(
			config,
			Scene.given({
				...withoutLinks,
				externalChannels: ExternalChannels.Failure({ error: "ProviderError" }),
				selectedChannel: hazelChannel,
			}),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.expect(Scene.text("Could not load Discord channels")).toExist(),
			Scene.expect(Scene.within(dialog, tryAgain)).toBeAbsent(),
			Scene.expect(linkButton).toBeDisabled(),
		)
	})
})

describe("a Slack connection", () => {
	const slackFound = [
		Message.SucceededListConnections({ organizationId, connections: [slackConnection] }),
		Message.SucceededListExternalChannels({
			workspaceId: slackConnection.externalWorkspaceId,
			channels: slackChannels,
		}),
		Message.UpdatedHazelChannels({ channels: [hazelChannel] }),
		Message.UpdatedChannelNames({ names: { [hazelChannel.id]: "engineering" } }),
	].reduce(step, init({ ...route, connectionId: slackSyncConnectionId }, shared).model)
	const withSlackLink = step(slackFound, Message.SucceededListChannelLinks({ version: 1, links: [link] }))
	const withoutSlackLinks = step(slackFound, Message.SucceededListChannelLinks({ version: 1, links: [] }))

	test("names Slack and has no webhook identity on its links", () => {
		Scene.scene(
			config,
			Scene.given(withSlackLink),
			linkMenuMounted,
			Scene.expect(Scene.text("Connected to Slack")).toExist(),
			Scene.expect(Scene.text("Workspace ID: T024BE7LD")).toExist(),
			Scene.expect(Scene.text("general")).toExist(),
			Scene.expect(Scene.text("Webhook")).toBeAbsent(),
		)
	})

	test("the link modal lists the Slack channels and links one", () => {
		Scene.scene(
			config,
			Scene.given(withoutSlackLinks),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Slack Channel"))).toExist(),
			Scene.expect(
				Scene.within(dialog, Scene.text(/Private channels are not supported yet\./)),
			).toExist(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: /engineering$/ }))),
			Scene.type(Scene.placeholder("Search Slack channels..."), "launch"),
			Scene.expect(Scene.within(dialog, Scene.text("design-reviews"))).toBeAbsent(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: /launch-room$/ }))),
			Scene.click(Scene.within(dialog, Scene.text("Slack to Hazel"))),
			Scene.click(linkButtonOf()),
			Scene.Command.expectExact(
				CreateChannelLink({
					syncConnectionId: slackSyncConnectionId,
					hazelChannelId: hazelChannel.id,
					hazelChannelName: "engineering",
					externalChannelId: slackChannels[2]!.id,
					externalChannelName: "launch-room",
					direction: "external_to_hazel",
				}),
			),
			Scene.Command.resolve(CreateChannelLink, Message.FailedCreateLink({ reason: "AlreadyLinked" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Link already exists",
						description: "This channel is already synced.",
					},
				}),
			),
		)
	})

	test("Slack channels that fail to load because Slack is not installed ask to connect it", () => {
		Scene.scene(
			config,
			Scene.given({
				...withoutSlackLinks,
				externalChannels: ExternalChannels.Failure({ error: "NotConnected" }),
			}),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Connect Slack first"))).toExist(),
			Scene.expect(linkButtonOf()).toBeDisabled(),
		)
	})
})
