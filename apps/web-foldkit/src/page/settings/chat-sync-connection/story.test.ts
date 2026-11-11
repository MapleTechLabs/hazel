import "../../../test/document-stub"
import { routeOfPath } from "../../../route"
import {
	ChannelId,
	ExternalChannelId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
} from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
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
	UpdateChannelLink,
} from "./command"
import { ChannelLinks, ConnectionLookup, directionLabel, Message, Submission } from "./model"
import { init, update } from "./update"
import { sharedDefaults } from "../../test-shared"
import { linkMenuEntries } from "./model"

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
const connection = {
	id: connectionId,
	provider: "discord" as const,
	displayName: "Hazel Community",
	status: "active" as const,
	externalWorkspaceId: "918273645500120",
	errorMessage: null,
	lastSyncedAtMs: null,
}
const run = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const route = { _tag: "SettingsChatSyncConnection" as const, orgSlug: "hazel", connectionId }
const loaded = [
	Message.SucceededListConnections({ organizationId, connections: [connection] }),
	Message.SucceededListChannelLinks({ version: 1, links: [link] }),
].reduce((current, next) => run(current, next).model, init(route, shared).model)

describe("chat sync connection", () => {
	test("init lists the connections and the channel links", () => {
		const names = init(route, shared).commands?.map((command) => command.name)
		expect(names).toContain(ListChatSyncConnectionsForConnection.name)
		expect(names).toContain(ListChannelLinks.name)
	})

	test("Remove link from the row menu confirms, removes and refreshes the shown links", () => {
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
				Message.GotLinkMenuMessage({
					linkId,
					message: Menu.Message.ClickedItem({ key: "remove", entries: linkMenuEntries }),
				}),
			),
			model((current) => {
				expect(current.removeLinkConfirm.state).toEqual({
					_tag: "Confirming",
					target: { id: linkId, name: "general" },
				})
				expect(current.removeLinkConfirm.modal.isOpen).toBe(true)
			}),
			Command.resolveAll(),
			message(Message.ClickedConfirmRemoveLink()),
			Command.resolve(RemoveChannelLink, Message.SucceededRemoveLink()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Channel link removed", description: null },
				}),
			),
			model((current) => {
				expect(current.removeLinkConfirm.state._tag).toBe("Closed")
				expect(current.links).toEqual(ChannelLinks.Refreshing({ data: [link] }))
			}),
			Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ version: 2, links: [] })),
		)
	})

	test("disconnecting returns to the list with the success toast", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedDisconnect()),
			message(Message.ClickedConfirmDisconnect()),
			Command.expectExact(DisconnectConnection({ syncConnectionId: connectionId })),
			Command.resolve(DisconnectConnection, Message.SucceededDisconnect()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/chat-sync"),
					replace: false,
					toast: { intent: "success", title: "Connection deleted", description: null },
				}),
			),
			model((current) => expect(current.disconnectConfirm.modal.isOpen).toBe(false)),
		)
	})

	test("an older links list is dropped once a reload is out", () => {
		const reloading = { ...loaded, linksVersion: 2, links: ChannelLinks.Loading() }
		expect(
			run(reloading, Message.SucceededListChannelLinks({ version: 1, links: [] })).model.links,
		).toEqual(ChannelLinks.Loading())
		expect(
			run(reloading, Message.FailedListChannelLinks({ version: 1, reason: "Offline" })).model.links,
		).toEqual(ChannelLinks.Loading())
		expect(
			run(reloading, Message.SucceededListChannelLinks({ version: 2, links: [link] })).model.links,
		).toEqual(ChannelLinks.Success({ data: [link] }))
	})

	test("a failed first links list is a failure with a retry, not an empty list", () => {
		story(
			run,
			given(init(route, shared).model),
			message(Message.FailedListChannelLinks({ version: 1, reason: "Unavailable" })),
			model((current) => {
				expect(current.links).toEqual(ChannelLinks.Failure({ error: "Unavailable" }))
				expect(current.linkMenus).toEqual([])
			}),
			message(Message.ClickedRetryListChannelLinks()),
			Command.expectExact(ListChannelLinks({ syncConnectionId: connectionId, version: 2 })),
			model((current) => expect(current.links).toEqual(ChannelLinks.Loading())),
			Command.resolve(
				ListChannelLinks,
				Message.SucceededListChannelLinks({ version: 2, links: [link] }),
			),
			model((current) => expect(current.links).toEqual(ChannelLinks.Success({ data: [link] }))),
		)
	})

	test("a failed links reload keeps the shown links and toasts", () => {
		const reloading = { ...loaded, linksVersion: 2, links: ChannelLinks.Refreshing({ data: [link] }) }
		const failed = run(
			reloading,
			Message.FailedListChannelLinks({ version: 2, reason: "ConnectionNotFound" }),
		)
		expect(failed.model.links).toEqual(ChannelLinks.Stale({ error: "ConnectionNotFound", data: [link] }))
		expect(failed.model.linkMenus).toHaveLength(1)
		expect(failed.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: {
					intent: "error",
					title: "Connection not found",
					description: "This sync connection may have been deleted.",
				},
			}),
		)
	})

	test("a failed connection list is a failure with a retry, not 'connection not found'", () => {
		story(
			run,
			given(init(route, shared).model),
			message(Message.FailedListConnections({ organizationId, reason: "Offline" })),
			model((current) =>
				expect(current.connection).toEqual(ConnectionLookup.Failure({ error: "Offline" })),
			),
			message(Message.ClickedRetryLoadConnection()),
			Command.expectExact(ListChatSyncConnectionsForConnection({ organizationId })),
			model((current) => expect(current.connection).toEqual(ConnectionLookup.Loading())),
			Command.resolve(
				ListChatSyncConnectionsForConnection,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			),
			Command.resolve(
				ListExternalChannels,
				Message.SucceededListExternalChannels({
					workspaceId: connection.externalWorkspaceId,
					channels: [],
				}),
			),
			model((current) =>
				expect(current.connection).toEqual(ConnectionLookup.Success({ data: connection })),
			),
		)
	})

	test("a found connection mounts the link modal, which lists its guild's Discord channels", () => {
		const channel = {
			id: Schema.decodeSync(ExternalChannelId)("1"),
			name: "general",
			isPrivate: false,
			isMember: true,
		}
		story(
			run,
			given(init(route, shared).model),
			message(Message.SucceededListConnections({ organizationId, connections: [connection] })),
			Command.expectExact(
				ListExternalChannels({ organizationId, provider: "discord", workspaceId: "918273645500120" }),
			),
			Command.resolve(
				ListExternalChannels,
				Message.SucceededListExternalChannels({
					workspaceId: "918273645500120",
					channels: [channel],
				}),
			),
			model((current) =>
				expect(current.externalChannels).toEqual(ExternalChannels.Success({ data: [channel] })),
			),
		)
		const listing = run(
			init(route, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		)
		const otherGuild = run(
			listing.model,
			Message.SucceededListExternalChannels({ workspaceId: "1", channels: [channel] }),
		)
		expect(otherGuild.model.externalChannels).toEqual(ExternalChannels.Loading())
	})

	test("failed Discord channels keep their reason, and Try again lists them again", () => {
		const listing = run(
			init(route, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		story(
			run,
			given(listing),
			message(
				Message.FailedListExternalChannels({ workspaceId: "918273645500120", reason: "Timeout" }),
			),
			model((current) =>
				expect(current.externalChannels).toEqual(ExternalChannels.Failure({ error: "Timeout" })),
			),
			message(Message.ClickedRetryListExternalChannels()),
			Command.expectExact(
				ListExternalChannels({ organizationId, provider: "discord", workspaceId: "918273645500120" }),
			),
			Command.resolve(
				ListExternalChannels,
				Message.SucceededListExternalChannels({ workspaceId: "918273645500120", channels: [] }),
			),
		)
	})

	test("a missing connection sends no channel query", () => {
		const missing = run(
			init(route, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [] }),
		)
		expect(missing.commands ?? []).toHaveLength(0)
		expect(missing.model.connection).toEqual(ConnectionLookup.Success({ data: null }))
	})

	test("linking a picked pair closes the modal, toasts, and refreshes the links", () => {
		const hazel = { id: link.hazelChannelId, name: "random" }
		const discord = {
			id: Schema.decodeSync(ExternalChannelId)("555000111222401"),
			name: "announcements",
			isPrivate: false,
			isMember: true,
		}
		story(
			run,
			given(loaded),
			message(Message.ClickedLinkChannel()),
			message(Message.ClickedHazelChannel({ channel: hazel })),
			message(Message.ClickedExternalChannel({ channel: discord })),
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
					toast: {
						intent: "success",
						title: "Linked #random to #announcements",
						description: null,
					},
				}),
			),
			model((current) => {
				expect(current.addLinkModal.isOpen).toBe(false)
				expect(current.selectedChannel).toBeNull()
				expect(current.direction).toBe("both")
				expect(current.submission).toEqual(Submission.NotSubmitted())
				expect(current.links._tag).toBe("Refreshing")
			}),
			Command.resolve(ListChannelLinks, Message.SucceededListChannelLinks({ version: 2, links: [] })),
		)
	})
})

describe("chat sync connection guards and link actions", () => {
	const openMenu = Message.GotLinkMenuMessage({
		linkId,
		message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
	})
	const pick = (key: string) =>
		Message.GotLinkMenuMessage({
			linkId,
			message: Menu.Message.ClickedItem({ key, entries: linkMenuEntries }),
		})

	test("Pause sync from the row menu pauses the link, toasts and reloads", () => {
		story(
			run,
			given(loaded),
			message(openMenu),
			Command.resolveAll(),
			message(pick("toggle")),
			Command.expectHas(
				UpdateChannelLink({ syncChannelLinkId: linkId, provider: "discord", isActive: false }),
			),
			Command.resolve(
				UpdateChannelLink,
				Message.SucceededUpdateLink({ linkId, successMessage: "Channel link paused" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Channel link paused", description: null },
				}),
			),
			Command.resolveAll([
				ListChannelLinks,
				Message.SucceededListChannelLinks({ version: 2, links: [{ ...link, isActive: false }] }),
			]),
			model((current) =>
				expect(current.links).toEqual(ChannelLinks.Success({ data: [{ ...link, isActive: false }] })),
			),
		)
	})

	test("a second pause while one runs sends nothing, and a settled link can update again", () => {
		const updating = run(run(loaded, openMenu).model, pick("toggle")).model
		expect(updating.updatingLinkIds).toEqual([linkId])
		const again = run(run(updating, openMenu).model, pick("toggle"))
		expect(again.commands?.some((command) => command.name === UpdateChannelLink.name)).toBe(false)
		const failed = run(updating, Message.FailedUpdateLink({ linkId, reason: "Unexpected" }))
		expect(failed.model.updatingLinkIds).toEqual([])
		const retried = run(run(failed.model, openMenu).model, pick("toggle"))
		expect(retried.commands?.some((command) => command.name === UpdateChannelLink.name)).toBe(true)
	})

	test("a failed link action toasts its reason and leaves the links loaded", () => {
		story(
			run,
			given(loaded),
			message(Message.FailedUpdateLink({ linkId, reason: "LinkNotFound" })),
			Command.expectNone(),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Link not found",
						description: "This channel link may have already been removed.",
					},
				}),
			),
			model((current) => expect(current.links._tag).toBe("Success")),
		)
	})

	test("a second confirm while disconnecting or removing sends nothing", () => {
		const [disconnecting] = Option.getOrThrow(
			ConfirmAction.confirm(ConfirmAction.ask(loaded.disconnectConfirm, connectionId)),
		)
		expect(
			run({ ...loaded, disconnectConfirm: disconnecting }, Message.ClickedConfirmDisconnect())
				.commands ?? [],
		).toHaveLength(0)
		const [removing] = Option.getOrThrow(
			ConfirmAction.confirm(
				ConfirmAction.ask(loaded.removeLinkConfirm, { id: linkId, name: "general" }),
			),
		)
		expect(
			run({ ...loaded, removeLinkConfirm: removing }, Message.ClickedConfirmRemoveLink()).commands ??
				[],
		).toHaveLength(0)
		story(run, given(loaded), message(Message.ClickedConfirmRemoveLink()), Command.expectNone())
	})

	test("a connection list for another organization is ignored", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(9))
		story(
			run,
			given(init(route, shared).model),
			message(Message.FailedListConnections({ organizationId: other, reason: "Offline" })),
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
			model((current) => expect(current.submission).toEqual(Submission.NotSubmitted())),
		)
	})
})

describe("a Slack connection", () => {
	const slackConnection = {
		...connection,
		provider: "slack" as const,
		displayName: "Acme Corp",
		externalWorkspaceId: "T024BE7LD",
	}

	test("a found Slack connection lists its workspace's Slack channels", () => {
		story(
			run,
			given(init(route, shared).model),
			message(Message.SucceededListConnections({ organizationId, connections: [slackConnection] })),
			Command.expectExact(
				ListExternalChannels({ organizationId, provider: "slack", workspaceId: "T024BE7LD" }),
			),
			Command.resolve(
				ListExternalChannels,
				Message.SucceededListExternalChannels({ workspaceId: "T024BE7LD", channels: [] }),
			),
			model((current) =>
				expect(current.externalChannels).toEqual(ExternalChannels.Success({ data: [] })),
			),
		)
	})

	test("a Slack link's update carries its provider, and directions name Slack", () => {
		const slackLoaded = [
			Message.SucceededListConnections({ organizationId, connections: [slackConnection] }),
			Message.SucceededListChannelLinks({ version: 1, links: [link] }),
		].reduce((current, next) => run(current, next).model, init(route, shared).model)
		const updated = run(
			run(
				slackLoaded,
				Message.GotLinkMenuMessage({
					linkId,
					message: Menu.Message.PressedTrigger({ pointerType: "mouse" }),
				}),
			).model,
			Message.GotLinkMenuMessage({
				linkId,
				message: Menu.Message.ClickedItem({ key: "toggle", entries: linkMenuEntries }),
			}),
		)
		expect(updated.commands?.map((command) => command.args)).toContainEqual(
			UpdateChannelLink({ syncChannelLinkId: linkId, provider: "slack", isActive: false }).args,
		)
		expect(directionLabel("hazel_to_external", "slack")).toBe("Hazel to Slack")
		expect(directionLabel("external_to_hazel", "discord")).toBe("Discord to Hazel")
	})
})
