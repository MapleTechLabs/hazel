import "../../channel-settings/document-stub"
import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./model"
import { DeleteConnection, init, ListConnections, sharedChanged, update } from "./update"

const organizationId = Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000001")
const connectionId = Schema.decodeSync(SyncConnectionId)("00000000-0000-4000-8000-000000000002")
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
}
const connection = {
	id: connectionId,
	displayName: "Hazel Community",
	status: "active" as const,
	externalWorkspaceId: "1",
	lastSyncedAtMs: null,
}
const updateWithShared = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)

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
			message(Message.ClickedDeleteConnection({ target: { id: connectionId, name: "Hazel Community" } })),
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
			Command.resolve(ListConnections, Message.SucceededListConnections({ organizationId, connections: [] })),
			model((current) => expect(current.connections).toEqual({ _tag: "Loaded", connections: [] })),
		)
	})
})
