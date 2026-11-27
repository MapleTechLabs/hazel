// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../../app/requests"
import type { ChatSyncList, Connection, EmailInbox } from "../../chat-sync/model"
import {
	ChatSyncPageMessage as M,
	ChatSyncPageNoDeps,
	CheckMigrationReturn,
	CreateConnection,
	CreateEmailInbox,
	DeleteConnection,
	ListChatSync,
	ListWorkspaces,
	UpdateEmailInbox,
} from "./ChatSyncPage"

/** Chat sync settings (`/:org/settings/chat-sync`): connections, the add dialog, inboxes. */

const org = OrganizationId.make("00000002-0000-4000-8000-000000000001")
const support = ChannelId.make("00000005-0000-4000-8000-000000000003")
const props = { organizationId: org, orgSlug: "hazel" }

const connection = (n: number, provider: "slack" | "discord", name: string): Connection => ({
	id: SyncConnectionId.make(`0000000d-0000-4000-8000-00000000000${n}`),
	provider,
	displayName: name,
	status: "active",
	externalWorkspaceId: `W${n}`,
	errorMessage: null,
	lastSyncedAtMs: null,
})
const linear = connection(1, "slack", "Linear")
const inbox: EmailInbox = {
	id: SyncConnectionId.make("0000000d-0000-4000-8000-000000000003"),
	displayName: "Acme Support",
	status: "active",
	errorMessage: null,
	inboundAddress: "acme@in.hazel.test",
	supportAddress: null,
	hazelChannelId: support,
}
const list: ChatSyncList = { connections: [linear], emailInboxes: [inbox] }
const CHANNELS = `channels:"${org}"`

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const dialog = (key: string): Locator.Locator => ({
	description: `<hz:dialog key=${key}>`,
	all: (root) => Locator.all(root, Locator.tag("hz:dialog")).filter((node) => node.props?.["key"] === key),
})
/** A dialog's own button, by its key (closed dialogs keep theirs in the tree). */
const dialogButton = (dialogKey: string, key: string): Locator.Locator => ({
	description: `<hz:dialog key=${dialogKey}> <hz:button key=${key}>`,
	all: (root) =>
		dialog(dialogKey)
			.all(root)
			.flatMap((node) => Locator.all(node, Locator.tag("hz:button")))
			.filter((node) => node.props?.["key"] === key),
})
const isOpen = (s: { get: (locator: Locator.Locator) => { props?: Record<string, unknown> } }, key: string) =>
	s.get(dialog(key)).props?.["open"] === true

const loaded = (value: ChatSyncList = list) =>
	Scene.start(ChatSyncPageNoDeps, props)
		.expectExact(ListChatSync.make({ organizationId: org }), CheckMigrationReturn.make({}))
		.resolve(CheckMigrationReturn, M.CompletedCheckMigrationReturn({ pending: false }))
		.resolve(ListChatSync, M.SucceededList({ list: value }))
		.subscription(CHANNELS, M.UpdatedChannels({ channels: [{ id: support, name: "support" }] }))

const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	ShowToast.make({ toast: { intent, title, description } })

describe("chat sync page", () => {
	test("loads, then lists the connections and the inboxes", () => {
		const s = Scene.start(ChatSyncPageNoDeps, props)
		s.expect(byProp("progress", "label", "Loading connections...")).toExist()
		s.resolve(CheckMigrationReturn, M.CompletedCheckMigrationReturn({ pending: false }))
			.resolve(ListChatSync, M.SucceededList({ list }))
			.subscription(CHANNELS, M.UpdatedChannels({ channels: [{ id: support, name: "support" }] }))
			.expect(byProp("heading", "children", "Linear"))
		expect(Locator.textOf(s.root)).toContain("Slack · Workspace ID: W1")
		expect(Locator.textOf(s.root)).toContain("# support · Replies come from the forwarding address")
		expect(s.get(byProp("link", "label", "Manage")).props?.["href"]).toBe(
			`/hazel/settings/chat-sync/${linear.id}`,
		)
	})

	test("a failed first load offers Try again; none listed offers to add one", () => {
		Scene.start(ChatSyncPageNoDeps, props)
			.resolve(CheckMigrationReturn, M.CompletedCheckMigrationReturn({ pending: false }))
			.resolve(ListChatSync, M.FailedList({ reason: "Offline" }))
			.expect(byProp("emptyState", "title", "Failed to load connections"))
			.toExist()
			.fire(button("Try again"), "press")
			.expect(byProp("progress", "label", "Loading connections..."))
			.toExist()
		loaded({ connections: [], emailInboxes: [] })
			.expect(byProp("emptyState", "title", "No sync connections yet"))
			.toExist()
	})

	test("adds a Discord server: picks it from the list and connects", () => {
		const guild = { id: "G1", name: "Builders", owner: true }
		const s = loaded()
			.fire(byProp("menu", "label", "Add third-party connection"), "select", { id: "discord" })
			.expectExact(ListWorkspaces.make({ organizationId: org, provider: "discord" }))
			.resolve(ListWorkspaces, M.SucceededListWorkspaces({ provider: "discord", workspaces: [guild] }))
		expect(isOpen(s, "add-connection")).toBe(true)
		expect(s.get(button("Connect")).props?.["disabled"]).toBe(true)
		s.fire(byProp("select", "label", "Discord Server"), "change", { value: "G1" })
			.fire(button("Connect"), "press")
			.expectExact(
				CreateConnection.make({
					organizationId: org,
					provider: "discord",
					externalWorkspaceId: "G1",
					externalWorkspaceName: "Builders",
				}),
			)
			.resolve(CreateConnection, M.SucceededCreateConnection())
			.expectExact(
				ListChatSync.make({ organizationId: org }),
				toast("success", "Discord connection created"),
			)
		expect(isOpen(s, "add-connection")).toBe(false)
	})

	test("a provider not connected points to its integration", () => {
		const s = loaded()
			.fire(byProp("menu", "label", "Add third-party connection"), "select", { id: "slack" })
			.resolve(ListWorkspaces, M.FailedListWorkspaces({ provider: "slack", reason: "NotConnected" }))
		s.expect(byProp("banner", "title", "Connect Slack first")).toExist()
		expect(s.get(byProp("link", "label", "Open Slack Integration")).props?.["href"]).toBe(
			"/hazel/settings/integrations/slack",
		)
	})

	test("deletes a connection after confirming, and asks again when it fails", () => {
		const s = loaded({ connections: [linear], emailInboxes: [] }).fire(
			byProp("button", "icon", "trash"),
			"press",
		)
		expect(isOpen(s, "delete-connection")).toBe(true)
		s.fire(dialogButton("delete-connection", "confirm"), "press")
		s.expectExact(
			DeleteConnection.make({ organizationId: org, syncConnectionId: linear.id, inbox: false }),
		)
			.resolve(DeleteConnection, M.FailedDeleteConnection({ reason: "NotFound" }))
			.expectExact(
				toast("error", "Connection not found", "This connection may have already been deleted."),
			)
		expect(isOpen(s, "delete-connection")).toBe(true)
	})

	test("creates an inbox: the form says what is missing, then moves to the setup guide", () => {
		const s = loaded().fire(button("Add inbox"), "press").fire(button("Create inbox"), "press")
		expect(s.get(byProp("textField", "label", "Name")).props?.["error"]).toBe(
			"Enter a name for the inbox.",
		)
		expect(Locator.textOf(s.root)).toContain("Pick the channel emails arrive in.")
		s.fire(byProp("textField", "label", "Name"), "change", { value: "Acme", rev: 1, edit: 0 })
			.fire(byProp("select", "label", "Channel"), "change", { value: support })
			.fire(button("Create inbox"), "press")
			.expectExact(
				CreateEmailInbox.make({
					organizationId: org,
					displayName: "Acme",
					supportAddress: null,
					hazelChannelId: support,
				}),
			)
			.resolve(CreateEmailInbox, M.SucceededCreateInbox({ inbox: { ...inbox, displayName: "Acme" } }))
		expect(s.get(dialog("email-inbox")).props?.["title"]).toBe("Acme is ready")
	})

	test("edits an inbox's name and reply-to", () => {
		const s = loaded().fire(button("Edit inbox"), "press")
		expect(s.get(dialog("email-inbox")).props?.["title"]).toBe("Edit inbox")
		s.fire(byProp("textField", "label", "Support address (optional)"), "change", {
			value: "help@acme.test",
			rev: 1,
			edit: 0,
		})
			.fire(button("Save"), "press")
			.expectExact(
				UpdateEmailInbox.make({
					organizationId: org,
					syncConnectionId: inbox.id,
					displayName: "Acme Support",
					supportAddress: "help@acme.test",
				}),
			)
			.resolve(UpdateEmailInbox, M.SucceededUpdateInbox())
		expect(isOpen(s, "email-inbox")).toBe(false)
	})

	test("back from a provider's OAuth, the migration wizard opens again", () => {
		const s = Scene.start(ChatSyncPageNoDeps, props).resolve(
			CheckMigrationReturn,
			M.CompletedCheckMigrationReturn({ pending: true }),
		)
		expect(isOpen(s, "chat-migration-dialog")).toBe(true)
	})
})
