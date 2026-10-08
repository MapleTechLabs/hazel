import "../../channel-settings/document-stub"
import { ChannelId, ExternalChannelId, OrganizationId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	CreateChannelLink,
	DisconnectConnection,
	ListChannelLinks,
	ListDiscordChannels,
	RemoveChannelLink,
	ScheduleReturnToList,
	UpdateChannelLink,
} from "./command"
import { Message } from "./model"
import { init, update } from "./update"
import { sharedDefaults } from "../../test-shared"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const connectionId = Schema.decodeSync(SyncConnectionId)(uuid(2))
const linkId = Schema.decodeSync(SyncChannelLinkId)(uuid(3))
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const link = {
	id: linkId,
	hazelChannelId: Schema.decodeSync(ChannelId)(uuid(4)),
	externalName: "general",
	direction: "both" as const,
	isActive: true,
	webhookPermission: "allowed" as const,
}
const run = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const route = { _tag: "SettingsChatSyncConnection" as const, orgSlug: "hazel", connectionId }
const loaded = run(init(route, shared).model, Message.SucceededListChannelLinks({ links: [link] })).model

describe("chat sync connection", () => {
	test("init lists the connections and the channel links", () => {
		expect(init(route, shared).commands?.map((command) => command.name)).toEqual([
			"ListConnections",
			"ListChannelLinks",
		])
	})

	test("Remove link from the row menu confirms, removes and reloads the links", () => {
		story(
			run,
			given(loaded),
			message(
				Message.GotLinkMenuMessage({
					linkId,
					message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
				}),
			),
			Command.resolveAll(),
			message(
				Message.GotLinkMenuMessage({ linkId, message: Menu.Message.ClickedItem({ key: "remove" }) }),
			),
			model((current) => {
				expect(current.deleteTarget).toEqual({ id: linkId, name: "general" })
				expect(current.deleteLinkModal.isOpen).toBe(true)
			}),
			Command.resolveAll(),
			message(Message.ClickedConfirmRemoveLink()),
			Command.resolve(RemoveChannelLink, Message.SucceededRemoveLink()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Channel link removed", description: null },
				}),
			),
			model((current) => expect(current.links._tag).toBe("Loading")),
			Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ links: [] })),
		)
	})

	test("disconnecting toasts, then returns to the list", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedDisconnect()),
			message(Message.ClickedConfirmDisconnect()),
			Command.resolve(DisconnectConnection, Message.SucceededDisconnect()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Connection deleted", description: null },
				}),
			),
			Command.resolve(ScheduleReturnToList, Message.ReachedReturnToList()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/chat-sync", replace: false }),
			),
		)
	})

	test("a found connection mounts the link modal, which lists its guild's Discord channels", () => {
		const connection = {
			id: connectionId,
			displayName: "Hazel Community",
			status: "active" as const,
			externalWorkspaceId: "918273645500120",
			errorMessage: null,
			lastSyncedAtMs: null,
		}
		const channel = { id: Schema.decodeSync(ExternalChannelId)("1"), guildId: "918273645500120", name: "general", type: 0, parentId: null }
		story(
			run,
			given(init(route, shared).model),
			message(Message.SucceededListConnections({ organizationId, connections: [connection] })),
			Command.expectExact(ListDiscordChannels({ organizationId, guildId: "918273645500120" })),
			Command.resolve(
				ListDiscordChannels,
				Message.SucceededListDiscordChannels({ channels: [channel] }),
			),
			model((current) => expect(current.discordChannels).toEqual({ _tag: "Loaded", items: [channel] })),
		)
	})

	test("a missing connection sends no channel query", () => {
		const missing = run(
			init(route, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [] }),
		)
		expect(missing.commands ?? []).toHaveLength(0)
	})

	test("linking a picked pair closes the modal, toasts, and reloads the links", () => {
		const hazel = { id: link.hazelChannelId, name: "random" }
		const discord = {
			id: Schema.decodeSync(ExternalChannelId)("555000111222401"),
			guildId: "918273645500120",
			name: "announcements",
			type: 0,
			parentId: null,
		}
		story(
			run,
			given(loaded),
			message(Message.ClickedLinkChannel()),
			message(Message.ClickedHazelChannel({ channel: hazel })),
			message(Message.ClickedDiscordChannel({ channel: discord })),
			message(Message.ClickedDirection({ direction: "external_to_hazel" })),
			message(Message.ClickedCreateLink()),
			Command.expectExact(
				CreateChannelLink({
					syncConnectionId: connectionId,
					hazelChannelId: hazel.id,
					hazelChannelName: "random",
					externalChannelId: discord.id,
					externalChannelName: "announcements",
					direction: "external_to_hazel",
				}),
			),
			Command.resolve(
				CreateChannelLink,
				Message.SucceededCreateLink({ successMessage: "Linked #random to #announcements" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Linked #random to #announcements", description: null },
				}),
			),
			model((current) => {
				expect(current.addLinkModal.isOpen).toBe(false)
				expect(current.selectedChannel).toBeNull()
				expect(current.direction).toBe("both")
				expect(current.links._tag).toBe("Loading")
			}),
			Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ links: [] })),
		)
	})
})

describe("chat sync connection guards and link actions", () => {
	const openMenu = Message.GotLinkMenuMessage({ linkId, message: Menu.Message.PressedTrigger({ pointerType: "mouse" }) })
	const pick = (key: string) => Message.GotLinkMenuMessage({ linkId, message: Menu.Message.ClickedItem({ key }) })

	test("Pause sync from the row menu pauses the link, toasts and reloads", () => {
		story(
			run,
			given(loaded),
			message(openMenu),
			Command.resolveAll(),
			message(pick("toggle")),
			Command.expectHas(UpdateChannelLink({ syncChannelLinkId: linkId, isActive: false })),
			Command.resolve(UpdateChannelLink, Message.SucceededUpdateLink({ successMessage: "Channel link paused" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "success", title: "Channel link paused", description: null } }),
			),
			Command.resolveAll([ListChannelLinks, Message.SucceededListChannelLinks({ links: [{ ...link, isActive: false }] })]),
			model((current) => expect(current.links).toEqual({ _tag: "Loaded", links: [{ ...link, isActive: false }] })),
		)
	})

	test("a failed link action toasts and leaves the links loaded", () => {
		story(
			run,
			given(loaded),
			message(Message.FailedLinkAction({ title: "Channel link not found", description: null })),
			Command.expectNone(),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "error", title: "Channel link not found", description: null } }),
			),
			model((current) => expect(current.links._tag).toBe("Loaded")),
		)
	})

	test("a second confirm while disconnecting or removing sends nothing", () => {
		const disconnecting = run({ ...loaded, isDisconnecting: true }, Message.ClickedConfirmDisconnect())
		expect(disconnecting.commands ?? []).toHaveLength(0)
		const removing = run(
			{ ...loaded, deleteTarget: { id: linkId, name: "general" }, isDeletingLink: true },
			Message.ClickedConfirmRemoveLink(),
		)
		expect(removing.commands ?? []).toHaveLength(0)
		story(run, given(loaded), message(Message.ClickedConfirmRemoveLink()), Command.expectNone())
	})

	test("a connection list for another organization is ignored", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(9))
		story(
			run,
			given(init(route, shared).model),
			message(Message.FailedListConnections({ organizationId: other })),
			model((current) => expect(current.connection._tag).toBe("Loading")),
		)
	})

	test("Link Channel needs both channels picked", () => {
		const hazelChannel = { id: Schema.decodeSync(ChannelId)(uuid(5)), name: "engineering" }
		story(
			run,
			given(loaded),
			message(Message.ClickedHazelChannel({ channel: hazelChannel })),
			message(Message.ClickedCreateLink()),
			Command.expectNone(),
			model((current) => expect(current.isCreatingLink).toBe(false)),
		)
	})
})
