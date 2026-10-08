import "../../channel-settings/document-stub"
import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./model"
import { DeleteConnection, init, ListConnections, ListDiscordGuilds, sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"
import { CreateConnection } from "./add-connection"

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
	displayName: "Hazel Community",
	status: "active" as const,
	externalWorkspaceId: "1",
	errorMessage: null,
	lastSyncedAtMs: null,
}
const updateWithShared = (current: Parameters<typeof update>[0], next: Message) =>
	update(current, next, shared)

describe("chat sync connections", () => {
	test("waits for the organization before listing", () => {
		const waiting = init(undefined, { ...shared, organization: null })
		expect(waiting.commands ?? []).toHaveLength(0)
		const ready = sharedChanged(waiting.model, shared)
		expect(ready.commands?.map((command) => command.name)).toEqual(["ListConnections"])
	})

	test("deleting closes the dialog, toasts, and reloads the list", () => {
		const loaded = updateWithShared(
			init(undefined, shared).model,
			Message.SucceededListConnections({ organizationId, connections: [connection] }),
		).model
		story(
			updateWithShared,
			given(loaded),
			message(
				Message.ClickedDeleteConnection({ target: { id: connectionId, name: "Hazel Community" } }),
			),
			model((current) => expect(current.deleteModal.isOpen).toBe(true)),
			message(Message.ClickedConfirmDelete()),
			Command.resolve(DeleteConnection, Message.SucceededDeleteConnection()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Connection deleted", description: null },
				}),
			),
			model((current) => {
				expect(current.deleteTarget).toBeNull()
				expect(current.connections._tag).toBe("Loading")
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [] }),
			),
			// The reloaded list remounts the add modal, so its guild query runs again.
			Command.resolve(ListDiscordGuilds, Message.FailedListDiscordGuilds()),
			model((current) => expect(current.connections).toEqual({ _tag: "Loaded", connections: [] })),
		)
	})

	test("a loaded list mounts the add modal, which lists the Discord guilds", () => {
		const guild = { id: "918273645500120", name: "Hazel Community", icon: null, owner: true }
		story(
			updateWithShared,
			given(init(undefined, shared).model),
			message(Message.SucceededListConnections({ organizationId, connections: [connection] })),
			Command.expectExact(ListDiscordGuilds({ organizationId })),
			Command.resolve(ListDiscordGuilds, Message.SucceededListDiscordGuilds({ guilds: [guild] })),
			model((current) => expect(current.discordGuilds).toEqual({ _tag: "Loaded", items: [guild] })),
		)
	})

	test("a failed list renders no modal and sends no guild query", () => {
		const failed = updateWithShared(
			init(undefined, shared).model,
			Message.FailedListConnections({ organizationId }),
		)
		expect(failed.commands ?? []).toHaveLength(0)
	})

	test("connecting a picked guild closes the modal, toasts, and reloads the list", () => {
		const guild = { id: "918273645500901", name: "Design Systems Guild", icon: null, owner: true }
		const loaded = updateWithShared(
			updateWithShared(
				init(undefined, shared).model,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			).model,
			Message.SucceededListDiscordGuilds({ guilds: [guild] }),
		).model
		story(
			updateWithShared,
			given({ ...loaded, addModal: { ...loaded.addModal, isOpen: true } }),
			message(Message.ChangedGuildSearch({ value: "design" })),
			message(Message.ClickedGuild({ guild })),
			model((current) => expect(current.selectedGuild).toEqual(guild)),
			message(Message.ClickedConnect()),
			Command.expectExact(
				CreateConnection({
					organizationId,
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
				expect(current.selectedGuild).toBeNull()
				expect(current.guildSearch).toBe("")
				expect(current.connections._tag).toBe("Loading")
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [connection] }),
			),
			Command.resolve(ListDiscordGuilds, Message.SucceededListDiscordGuilds({ guilds: [guild] })),
		)
	})

	test("a failed create keeps the modal open with an error toast", () => {
		const failed = updateWithShared(
			{ ...init(undefined, shared).model, isCreating: true },
			Message.FailedCreateConnection({ title: "Connection already exists", description: null }),
		)
		expect(failed.model.isCreating).toBe(false)
		expect(failed.outMessage).toEqual(
			PageOutMessage.RequestedToast({
				toast: { intent: "error", title: "Connection already exists", description: null },
			}),
		)
	})
})
