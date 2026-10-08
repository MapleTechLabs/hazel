// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../ui/toast-exit"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import { makeShared, organizationId, pageScene, portalModalMounted } from "../../../test/pages-fixtures"
import { connection, guild, otherGuild, syncConnectionId } from "../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../out-message"
import { CreateConnection, FocusGuildSearch } from "./add-connection"
import { Message, type Model } from "./model"
import { DeleteConnection, init, ListConnections, ListDiscordGuilds, update } from "./update"
import { view } from "./view"

/** The chat sync list through its view: states, opening a connection, deleting and connecting a guild. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const step = (model: Model, message: Message) => update(model, message, shared).model
const initial = init(undefined, shared).model
const loadedWith = (connections: ReadonlyArray<typeof connection>) =>
	step(
		step(initial, Message.SucceededListConnections({ organizationId, connections })),
		Message.SucceededListDiscordGuilds({ guilds: [guild, otherGuild] }),
	)
const loaded = loadedWith([connection])
const withAddModalOpen = { ...loaded, addModal: Modal.open(loaded.addModal).model }

// The icon-only delete button is named by its icon's <title> ("badge 13"), so it is found by `title`.
const deleteTrigger = Scene.title("Delete connection")
const addTrigger = Scene.role("button", { name: /Add Third Party Connection/ })
const dialog = Scene.role("dialog")
const confirmDelete = Scene.within(dialog, Scene.role("button", { name: "Delete Connection" }))
const connect = Scene.within(dialog, Scene.role("button", { name: "Connect" }))
const search = Scene.placeholder("Search servers...")
/** The add menu trigger focuses itself on press; the add modal is a controlled (non-submodel) modal. */
const addTriggerMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
const addModalMounted = Scene.Mount.resolve(
	{ name: "PortalModal" },
	Message.GotAddModalMessage({ message: Modal.Message.CompletedPortalModal() }),
)

describe("list states", () => {
	test("a loading list shows a spinner and no add button", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.text("Loading connections...")).toExist(),
			Scene.expect(addTrigger).toBeAbsent(),
		)
	})

	test("a failed list explains the failure", () => {
		Scene.scene(
			config,
			Scene.given(step(initial, Message.FailedListConnections({ organizationId }))),
			Scene.expect(Scene.text("Failed to load connections")).toExist(),
			Scene.expect(Scene.text("Loading connections...")).toBeAbsent(),
		)
	})

	test("an empty list shows the empty state with its own add button", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([])),
			addTriggerMounted,
			addTriggerMounted,
			Scene.expect(Scene.text("No sync connections yet")).toExist(),
			Scene.expect(addTrigger).toExist(),
		)
	})

	test("clicking a card opens the connection page", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			addTriggerMounted,
			Scene.expect(Scene.text("Active")).toExist(),
			Scene.click(Scene.text("Hazel Community")),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({
					href: `/hazel/settings/chat-sync/${syncConnectionId}`,
					replace: false,
				}),
			),
		)
	})
})

describe("delete a connection", () => {
	test("confirming deletes, toasts, closes the dialog and reloads the list", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			addTriggerMounted,
			Scene.click(deleteTrigger),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Hazel Community"))).toExist(),
			Scene.click(confirmDelete),
			Scene.Command.expectExact(DeleteConnection({ syncConnectionId })),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Deleting..." }))).toBeDisabled(),
			Scene.Command.resolve(DeleteConnection, Message.SucceededDeleteConnection()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Connection deleted") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.expect(Scene.text("Loading connections...")).toExist(),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.Command.resolve(ListConnections, Message.SucceededListConnections({ organizationId, connections: [] })),
			Scene.Command.resolve(ListDiscordGuilds, Message.FailedListDiscordGuilds()),
			Scene.expect(Scene.text("No sync connections yet")).toExist(),
			addTriggerMounted,
			addTriggerMounted,
		)
	})

	test("a failed delete toasts the error and re-enables the confirm button", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			addTriggerMounted,
			Scene.click(deleteTrigger),
			portalModalMounted,
			Scene.click(confirmDelete),
			Scene.Command.resolve(
				DeleteConnection,
				Message.FailedDeleteConnection({ title: "Connection not found", description: null }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Connection not found", description: null },
				}),
			),
			Scene.expect(confirmDelete).toBeEnabled(),
		)
	})

	test("Cancel closes the dialog without deleting", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			addTriggerMounted,
			Scene.click(deleteTrigger),
			portalModalMounted,
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Cancel" }))),
			Scene.Command.expectNone(),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
		)
	})
})

describe("connect a Discord server", () => {
	test("Connect stays disabled until a server is picked, then creates the connection", () => {
		Scene.scene(
			config,
			Scene.given(withAddModalOpen),
			addTriggerMounted,
			addModalMounted,
			Scene.Command.resolve(FocusGuildSearch, Message.CompletedFocusGuildSearch()),
			Scene.expect(connect).toBeDisabled(),
			Scene.type(search, "rust"),
			Scene.expect(Scene.text("Design Systems Guild")).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Rust Hackers" })),
			Scene.expect(search).toBeAbsent(),
			Scene.expect(connect).toBeEnabled(),
			Scene.click(connect),
			Scene.Command.expectExact(
				CreateConnection({
					organizationId,
					externalWorkspaceId: otherGuild.id,
					externalWorkspaceName: otherGuild.name,
				}),
			),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Connecting..." }))).toBeDisabled(),
			Scene.Command.resolve(CreateConnection, Message.SucceededCreateConnection()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Discord connection created") }),
			),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.Command.resolve(ListConnections, Message.SucceededListConnections({ organizationId, connections: [connection] })),
			Scene.Command.resolve(ListDiscordGuilds, Message.SucceededListDiscordGuilds({ guilds: [guild] })),
			addTriggerMounted,
			Scene.expect(Scene.text("Hazel Community")).toExist(),
		)
	})

	test("a failed create keeps the picked server and re-enables Connect", () => {
		Scene.scene(
			config,
			Scene.given({ ...withAddModalOpen, selectedGuild: guild }),
			addTriggerMounted,
			addModalMounted,
			Scene.click(connect),
			Scene.Command.resolve(
				CreateConnection,
				Message.FailedCreateConnection({ title: "Connection already exists", description: null }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Connection already exists", description: null },
				}),
			),
			Scene.expect(Scene.within(dialog, Scene.text("Design Systems Guild"))).toExist(),
			Scene.expect(connect).toBeEnabled(),
		)
	})

	test("without Discord authorized, the modal links to the Discord integration", () => {
		Scene.scene(
			config,
			Scene.given({ ...withAddModalOpen, discordGuilds: { _tag: "Failed" } }),
			addTriggerMounted,
			addModalMounted,
			Scene.expect(connect).toBeDisabled(),
			Scene.click(Scene.role("button", { name: "Open Discord Integration" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/integrations/discord", replace: false }),
			),
		)
	})
})
