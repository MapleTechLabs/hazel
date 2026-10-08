// @vitest-environment jsdom
import { ChannelId, ExternalChannelId, SyncChannelLinkId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import { successToast } from "../../../ui/toast-exit"
import { makeShared, organizationId, pageScene, portalModalMounted, uuid } from "../../../test/pages-fixtures"
import { connection, syncConnectionId } from "../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../out-message"
import {
	CreateChannelLink,
	DisconnectConnection,
	ListChannelLinks,
	RemoveChannelLink,
	ScheduleReturnToList,
} from "./command"
import { Message, type Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The connection page through its view: disconnecting, removing a link and linking a channel. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const step = (model: Model, message: Message) => update(model, message, shared).model
const route = { _tag: "SettingsChatSyncConnection", orgSlug: "hazel", connectionId: syncConnectionId } as const
const linkId = Schema.decodeSync(SyncChannelLinkId)(uuid(40))
const hazelChannel = { id: Schema.decodeSync(ChannelId)(uuid(41)), name: "engineering" }
const discordChannel = {
	id: Schema.decodeSync(ExternalChannelId)("918273645500777"),
	guildId: connection.externalWorkspaceId,
	name: "dev-chat",
	type: 0,
	parentId: null,
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
	Message.SucceededListDiscordChannels({ channels: [discordChannel] }),
	Message.UpdatedHazelChannels({ channels: [hazelChannel] }),
	Message.UpdatedChannelNames({ names: { [hazelChannel.id]: "engineering" } }),
].reduce(step, initial)
const withLink = step(found, Message.SucceededListChannelLinks({ links: [link] }))
const withoutLinks = step(found, Message.SucceededListChannelLinks({ links: [] }))

const dialog = Scene.role("dialog")
const inDialog = (name: string | RegExp) => Scene.within(dialog, Scene.role("button", { name }))
/** Each link row's menu trigger focuses itself on press. */
const linkMenuMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
/** The add link modal is a controlled modal: its Mount result arrives already wrapped. */
const addLinkModalMounted = Scene.Mount.resolve(
	{ name: "PortalModal" },
	Message.GotAddLinkModalMessage({ message: Modal.Message.CompletedPortalModal() }),
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
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/hazel/settings/chat-sync", replace: false })),
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
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Connection deleted") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Command.resolve(ScheduleReturnToList, Message.ReachedReturnToList()),
			Scene.expectOutMessage(PageOutMessage.RequestedNavigation({ href: "/hazel/settings/chat-sync", replace: false })),
		)
	})

	test("a failed disconnect toasts the error and closes the dialog", () => {
		Scene.scene(
			config,
			Scene.given(withoutLinks),
			Scene.click(Scene.role("button", { name: "Disconnect" })),
			portalModalMounted,
			Scene.click(inDialog("Disconnect")),
			Scene.Command.resolve(DisconnectConnection, Message.FailedDisconnect({ title: "Request failed", description: null })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "error", title: "Request failed", description: null } }),
			),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.expect(Scene.role("button", { name: "Disconnect" })).toBeEnabled(),
		)
	})
})

describe("remove a channel link", () => {
	const confirming = step(
		{ ...withLink, deleteTarget: { id: linkId, name: "general" } },
		Message.GotDeleteLinkModalMessage({ message: Modal.Message.ClickedTrigger() }),
	)

	test("confirming removes the link, toasts and reloads the links", () => {
		Scene.scene(
			config,
			Scene.given(confirming),
			linkMenuMounted,
			portalModalMounted,
			Scene.click(inDialog("Remove Link")),
			Scene.Command.expectExact(RemoveChannelLink({ syncChannelLinkId: linkId })),
			Scene.expect(inDialog("Removing...")).toBeDisabled(),
			Scene.Command.resolve(RemoveChannelLink, Message.SucceededRemoveLink()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Channel link removed") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.expect(Scene.text("Loading channel links...")).toExist(),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ links: [] })),
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
			Scene.Command.resolve(RemoveChannelLink, Message.FailedRemoveLink({ title: "Request failed", description: null })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "error", title: "Request failed", description: null } }),
			),
			Scene.expect(inDialog("Remove Link")).toBeEnabled(),
		)
	})
})

describe("link a channel", () => {
	const linkButton = inDialog("Link Channel")

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
			Scene.Command.resolve(CreateChannelLink, Message.SucceededCreateLink({ successMessage: "Channel linked" })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Channel linked") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ links: [link] })),
			linkMenuMounted,
			Scene.expect(Scene.text("general")).toExist(),
		)
	})

	test("a failed link keeps the picks and re-enables Link Channel", () => {
		Scene.scene(
			config,
			Scene.given({ ...withoutLinks, selectedChannel: hazelChannel, selectedDiscordChannel: discordChannel }),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.click(linkButton),
			Scene.Command.resolve(CreateChannelLink, Message.FailedCreateLink({ title: "Already linked", description: null })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "error", title: "Already linked", description: null } }),
			),
			Scene.expect(Scene.within(dialog, Scene.text("dev-chat"))).toExist(),
			Scene.expect(linkButton).toBeEnabled(),
		)
	})

	test("Discord channels that fail to load explain why and keep Link Channel disabled", () => {
		Scene.scene(
			config,
			Scene.given({ ...withoutLinks, discordChannels: { _tag: "Failed" }, selectedChannel: hazelChannel }),
			Scene.click(Scene.role("button", { name: /Link Channel$/ })),
			addLinkModalMounted,
			Scene.expect(Scene.text("Could not load Discord channels")).toExist(),
			Scene.expect(linkButton).toBeDisabled(),
		)
	})
})
