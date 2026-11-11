import "../../../test/document-stub"
import { routeOfPath } from "../../../route"
import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import * as Menu from "../../../ui/menu"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { addMenuEntries, Connections, Message, Submission } from "./model"
import { DeleteConnection, init, ListConnections, sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"
import { CreateConnection, FocusWorkspaceSearch, ListWorkspaces } from "./add-connection"
import { Workspaces } from "./providers"

const organizationId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000001")
const connectionId = Schema.decodeSync(SyncConnectionId)("00000000-0000-4000-8000-000000000002")
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const connection = {
	id: connectionId,
	provider: "discord" as const,
	displayName: "Hazel Community",
	status: "active" as const,
	externalWorkspaceId: "1",
	errorMessage: null,
	lastSyncedAtMs: null,
}
const target = { id: connectionId, name: "Hazel Community" }
const updateWithShared = (current: Parameters<typeof update>[0], next: Message) =>
	update(current, next, shared)

describe("chat sync connections", () => {
	test("waits for the organization before listing", () => {
		const waiting = init(undefined, { ...shared, organization: null })
		expect(waiting.commands ?? []).toHaveLength(0)
		const ready = sharedChanged(waiting.model, shared)
		expect(ready.commands?.map((command) => command.name)).toEqual(["ListConnections"])
	})

	test("deleting closes the dialog, toasts, and refreshes the list while keeping it shown", () => {
		const loaded = updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		story(
			updateWithShared,
			given(loaded),
			message(Message.ClickedDeleteConnection({ target })),
			model((current) => expect(current.deleteConfirm.modal.isOpen).toBe(true)),
			message(Message.ClickedConfirmDelete()),
			model((current) => expect(ConfirmAction.isRunning(current.deleteConfirm)).toBe(true)),
			Command.resolve(DeleteConnection, Message.SucceededDeleteConnection()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Connection deleted", description: null },
				}),
			),
			model((current) => {
				expect(current.deleteConfirm.state._tag).toBe("Closed")
				expect(current.deleteConfirm.modal.isOpen).toBe(false)
				expect(current.connections).toEqual(Connections.Refreshing({ data: [connection] }))
			}),
			// The add modal stays mounted through a refresh, so the guilds are not queried again.
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [] }),
			),
			Command.expectNone(),
			model((current) => expect(current.connections).toEqual(Connections.Success({ data: [] }))),
		)
	})

	test("a loaded list mounts the add modal, which lists the Discord guilds", () => {
		const guild = { id: "918273645500120", name: "Hazel Community", owner: true }
		story(
			updateWithShared,
			given(init(undefined, shared).model),
			message(Message.SucceededListConnections({ organizationId, connections: [connection] })),
			Command.expectExact(ListWorkspaces({ organizationId, provider: "discord", version: 1 })),
			Command.resolve(
				ListWorkspaces,
				Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
			),
			model((current) => expect(current.workspaces).toEqual(Workspaces.Success({ data: [guild] }))),
		)
	})

	test("a guild list for an older request or another organization is dropped", () => {
		const guild = { id: "918273645500120", name: "Hazel Community", owner: true }
		const listing = updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		const refetching = { ...listing, workspacesVersion: 2 }
		const stale = updateWithShared(
			refetching,
			Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
		)
		expect(stale.model.workspaces).toEqual(Workspaces.Loading())
		const staleFailure = updateWithShared(
			refetching,
			Message.FailedListWorkspaces({ organizationId, version: 1, reason: "Offline" }),
		)
		expect(staleFailure.model.workspaces).toEqual(Workspaces.Loading())
	})

	test("a failed guild list keeps its reason, and Try again queries the guilds anew", () => {
		const listing = updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		story(
			updateWithShared,
			given(listing),
			message(Message.FailedListWorkspaces({ organizationId, version: 1, reason: "Offline" })),
			model((current) => expect(current.workspaces).toEqual(Workspaces.Failure({ error: "Offline" }))),
			message(Message.ClickedRetryListWorkspaces()),
			Command.expectExact(ListWorkspaces({ organizationId, provider: "discord", version: 2 })),
			model((current) => expect(current.workspaces).toEqual(Workspaces.Loading())),
			Command.resolve(
				ListWorkspaces,
				Message.SucceededListWorkspaces({ organizationId, version: 2, workspaces: [] }),
			),
		)
	})

	test("a failed first list keeps its reason, sends no guild query, and Try again reloads", () => {
		story(
			updateWithShared,
			given(init(undefined, shared).model),
			message(Message.FailedListConnections({ organizationId, reason: "Offline" })),
			Command.expectNone(),
			model((current) =>
				expect(current.connections).toEqual(Connections.Failure({ error: "Offline" })),
			),
			message(Message.ClickedRetryListConnections()),
			Command.expectExact(ListConnections({ organizationId })),
			model((current) => expect(current.connections).toEqual(Connections.Loading())),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			),
			// The list mounts the add modal now, so the guilds are queried.
			Command.expectHas(ListWorkspaces),
			Command.resolve(
				ListWorkspaces,
				Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [] }),
			),
		)
	})

	test("a failed refresh keeps the shown list and toasts", () => {
		const loaded = updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		const failed = updateWithShared(
			{ ...loaded, connections: Connections.Refreshing({ data: [connection] }) },
			Message.FailedListConnections({ organizationId, reason: "Timeout" }),
		)
		expect(failed.model.connections).toEqual(Connections.Stale({ error: "Timeout", data: [connection] }))
		expect(failed.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: {
					intent: "error",
					title: "Request timed out",
					description: "The server is taking too long to respond. Please try again.",
				},
			}),
		)
	})

	test("connecting a picked guild closes the modal, toasts, and refreshes the list", () => {
		const guild = { id: "918273645500901", name: "Design Systems Guild", owner: true }
		const loaded = updateWithShared(
			updateWithShared(
				init(undefined, shared).model,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			).model,
			Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
		).model
		story(
			updateWithShared,
			given({ ...loaded, addModal: { ...loaded.addModal, isOpen: true } }),
			message(Message.ChangedWorkspaceSearch({ value: "design" })),
			message(Message.ClickedWorkspace({ workspace: guild })),
			model((current) => expect(current.selectedWorkspace).toEqual(guild)),
			message(Message.ClickedConnect()),
			Command.expectExact(
				CreateConnection({
					organizationId,
					provider: "discord",
					externalWorkspaceId: guild.id,
					externalWorkspaceName: guild.name,
				}),
			),
			Command.resolve(CreateConnection, Message.SucceededCreateConnection()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Discord connection created", description: null },
				}),
			),
			model((current) => {
				expect(current.addModal.isOpen).toBe(false)
				expect(current.selectedWorkspace).toBeNull()
				expect(current.workspaceSearch).toBe("")
				expect(current.submission).toEqual(Submission.NotSubmitted())
				expect(current.connections._tag).toBe("Refreshing")
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			),
		)
	})

	test("a failed create keeps the modal open with the reason's toast", () => {
		const failed = updateWithShared(
			{ ...init(undefined, shared).model, submission: Submission.Submitting() },
			Message.FailedCreateConnection({ reason: "AlreadyExists" }),
		)
		expect(failed.model.submission).toEqual(Submission.Failed({ reason: "AlreadyExists" }))
		expect(failed.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: {
					intent: "error",
					title: "Connection already exists",
					description: "A connection to this Discord server already exists in your workspace.",
				},
			}),
		)
	})
})

describe("chat sync guards", () => {
	const otherOrganizationId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000009")
	const guild = { id: "918273645500901", name: "Design Systems Guild", owner: true }
	const loaded = updateWithShared(
		init(undefined, shared).model,
		Message.SucceededListConnections({ organizationId, connections: [connection] }),
	).model

	test("a list for a previous organization is ignored", () => {
		story(
			updateWithShared,
			given(init(undefined, shared).model),
			message(
				Message.SucceededListConnections({
					organizationId: otherOrganizationId,
					connections: [connection],
				}),
			),
			Command.expectNone(),
			model((current) => expect(current.connections._tag).toBe("Loading")),
			message(
				Message.FailedListConnections({ organizationId: otherOrganizationId, reason: "Offline" }),
			),
			model((current) => expect(current.connections._tag).toBe("Loading")),
		)
	})

	test("a second confirm while deleting sends no second delete; a failure re-asks", () => {
		story(
			updateWithShared,
			given({ ...loaded, workspaces: Workspaces.Failure({ error: "NotConnected" }) }),
			message(Message.ClickedDeleteConnection({ target })),
			message(Message.ClickedConfirmDelete()),
			Command.expectExact(DeleteConnection({ syncConnectionId: connectionId })),
			Command.resolve(DeleteConnection, Message.FailedDeleteConnection({ reason: "NotFound" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection not found",
						description: "This connection may have already been deleted.",
					},
				}),
			),
			model((current) => {
				expect(current.deleteConfirm.state).toEqual({ _tag: "Confirming", target })
				expect(current.deleteConfirm.modal.isOpen).toBe(true)
			}),
		)
		const asked = ConfirmAction.ask(loaded.deleteConfirm, target)
		const [running] = Option.getOrThrow(ConfirmAction.confirm(asked))
		const deleting = updateWithShared(
			{ ...loaded, deleteConfirm: running },
			Message.ClickedConfirmDelete(),
		)
		expect(deleting.commands ?? []).toHaveLength(0)
	})

	test("Connect without a picked server, or while creating, sends nothing", () => {
		story(
			updateWithShared,
			given(loaded),
			message(Message.ClickedConnect()),
			Command.expectNone(),
			message(Message.ClickedWorkspace({ workspace: guild })),
			message(Message.ClickedConnect()),
			Command.expectHas(CreateConnection),
			model((current) => expect(current.submission).toEqual(Submission.Submitting())),
			Command.resolve(CreateConnection, Message.FailedCreateConnection({ reason: "NotConnected" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Discord not connected",
						description: "Connect Discord first to load your guilds.",
					},
				}),
			),
		)
		const creating = updateWithShared(
			{ ...loaded, selectedWorkspace: guild, submission: Submission.Submitting() },
			Message.ClickedConnect(),
		)
		expect(creating.commands ?? []).toHaveLength(0)
	})

	test("clicking a connection and the Discord link navigate inside the organization", () => {
		story(
			updateWithShared,
			given(loaded),
			message(Message.ClickedConnection({ connectionId })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath(`/hazel/settings/chat-sync/${connectionId}`),
					replace: false,
				}),
			),
			message(Message.ClickedOpenIntegration()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/integrations/discord"),
					replace: false,
				}),
			),
		)
	})
})

describe("chat sync providers", () => {
	const slackWorkspace = { id: "T024BE7LD", name: "Acme Corp", owner: false }
	const guild = { id: "918273645500901", name: "Design Systems Guild", owner: true }
	const loaded = updateWithShared(
		updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model,
		Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
	).model
	const pickFromAddMenu = (key: string) => [
		message(
			Message.GotAddMenuMessage({ message: Menu.Message.PressedTrigger({ pointerType: "mouse" }) }),
		),
		Command.resolveAll(),
		message(
			Message.GotAddMenuMessage({
				message: Menu.Message.ClickedItem({ key, entries: addMenuEntries }),
			}),
		),
	]

	test("picking Slack opens the modal for Slack and queries its installed workspace", () => {
		story(
			updateWithShared,
			given(loaded),
			...pickFromAddMenu("slack"),
			Command.expectHas(ListWorkspaces({ organizationId, provider: "slack", version: 2 })),
			model((current) => {
				expect(current.addProvider).toBe("slack")
				expect(current.addModal.isOpen).toBe(true)
				expect(current.workspaces).toEqual(Workspaces.Loading())
			}),
			Command.resolveAll([
				ListWorkspaces,
				Message.SucceededListWorkspaces({ organizationId, version: 2, workspaces: [slackWorkspace] }),
			]),
			// Slack's one workspace needs no pick.
			message(Message.ClickedConnect()),
			Command.expectExact(
				CreateConnection({
					organizationId,
					provider: "slack",
					externalWorkspaceId: "T024BE7LD",
					externalWorkspaceName: "Acme Corp",
				}),
			),
			Command.resolve(CreateConnection, Message.FailedCreateConnection({ reason: "NotConnected" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Slack not connected",
						description: "Install Hazel in this Slack workspace from Integrations first.",
					},
				}),
			),
		)
	})

	test("picking Discord again after Slack queries the guilds anew; the same provider keeps its list", () => {
		const slack = {
			...loaded,
			addProvider: "slack" as const,
			workspacesVersion: 2,
			workspaces: Workspaces.Success({ data: [slackWorkspace] }),
		}
		story(
			updateWithShared,
			given(slack),
			...pickFromAddMenu("discord"),
			Command.expectHas(ListWorkspaces({ organizationId, provider: "discord", version: 3 })),
			model((current) => expect(current.addProvider).toBe("discord")),
			Command.resolveAll([
				ListWorkspaces,
				Message.SucceededListWorkspaces({ organizationId, version: 3, workspaces: [guild] }),
			]),
			// Discord's server search takes focus once its list arrives in the open modal.
			Command.resolve(FocusWorkspaceSearch, Message.CompletedFocusWorkspaceSearch()),
		)
		const reopened = updateWithShared(
			updateWithShared(
				slack,
				Message.GotAddMenuMessage({ message: Menu.Message.PressedTrigger({ pointerType: "mouse" }) }),
			).model,
			Message.GotAddMenuMessage({
				message: Menu.Message.ClickedItem({ key: "slack", entries: addMenuEntries }),
			}),
		)
		expect(reopened.commands?.some((command) => command.name === ListWorkspaces.name)).toBe(false)
		expect(reopened.model.workspaces).toEqual(Workspaces.Success({ data: [slackWorkspace] }))
	})

	test("the Slack link navigates to the Slack integration", () => {
		story(
			updateWithShared,
			given({ ...loaded, addProvider: "slack" }),
			message(Message.ClickedOpenIntegration()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath("/hazel/settings/integrations/slack"),
					replace: false,
				}),
			),
		)
	})
})
