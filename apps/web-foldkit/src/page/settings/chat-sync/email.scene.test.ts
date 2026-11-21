// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../data/actions"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import * as Modal from "../../../ui/modal"
import { makeShared, organizationId, pageScene, portalModalMounted } from "../../../test/pages-fixtures"
import {
	connection,
	emailInbox,
	guild,
	salesChannel,
	supportChannel,
} from "../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../out-message"
import { CopyInboundAddress, CreateEmailInbox, RemoveEmailInbox, UpdateEmailInbox } from "./email"
import { Message, type Model } from "./model"
import { init, ListConnections, update } from "./update"
import { view } from "./view"

/** The Email section through the view: the inboxes, adding one, its setup, editing and removing. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const step = (model: Model, message: Message) => update(model, message, shared).model
const loadedWith = (inboxes: ReadonlyArray<typeof emailInbox>) =>
	[
		Message.SucceededListConnections({
			organizationId,
			connections: [connection],
			emailInboxes: inboxes,
		}),
		Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
		Message.UpdatedHazelChannels({ channels: [supportChannel, salesChannel] }),
	].reduce(step, init(undefined, shared).model)

const dialog = Scene.role("dialog")
const addTriggerMounted = Scene.Mount.resolve(
	FocusTriggerOnPress,
	Menu.Message.CompletedFocusTriggerOnPress(),
)
const addInbox = Scene.role("button", { name: /Add inbox/ })
const createInbox = Scene.within(dialog, Scene.role("button", { name: "Create inbox" }))
const nameInput = Scene.label("Name")
const supportInput = Scene.placeholder("support@acme.com")

describe("the Email section", () => {
	test("says what it does, and with no inbox says so", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([])),
			addTriggerMounted,
			Scene.expect(Scene.text("Email")).toExist(),
			Scene.expect(
				Scene.text(
					"Forward your support address to a Hazel channel. Each email becomes a thread; replies in the thread go back as email.",
				),
			).toExist(),
			Scene.expect(Scene.text("No inboxes yet.")).toExist(),
			Scene.expect(addInbox).toExist(),
		)
	})

	test("an inbox shows its channel, reply-to and forwarding address, without Slack or Discord actions", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([emailInbox])),
			addTriggerMounted,
			Scene.expect(Scene.text("Acme Support")).toExist(),
			Scene.expect(Scene.text("support")).toExist(),
			Scene.expect(Scene.text("Replies to support@acme.com")).toExist(),
			Scene.expect(Scene.text("acme-support-7f3k@in.hazel.sh")).toExist(),
			// The inbox is not a provider card: it has no Manage link to the Slack/Discord connection page.
			Scene.expect(Scene.text("Email · Workspace ID")).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Copy forwarding address" })),
			Scene.Command.expectExact(CopyInboundAddress({ address: "acme-support-7f3k@in.hazel.sh" })),
			Scene.Command.resolve(CopyInboundAddress, Message.SucceededCopyInboundAddress()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Forwarding address copied") }),
			),
		)
	})
})

describe("add an inbox", () => {
	test("Create shows inline errors, then creates and shows the forwarding setup", () => {
		const created = { ...emailInbox, supportAddress: null }
		Scene.scene(
			config,
			Scene.given(loadedWith([])),
			addTriggerMounted,
			Scene.click(addInbox),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Add email inbox"))).toExist(),
			Scene.click(createInbox),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Enter a name for the inbox.")).toExist(),
			Scene.expect(Scene.text("Pick the channel emails arrive in.")).toExist(),
			Scene.type(nameInput, "Acme Support"),
			Scene.type(supportInput, "support"),
			Scene.click(createInbox),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Enter an email address, like support@acme.com.")).toExist(),
			Scene.type(supportInput, ""),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "support" }))),
			Scene.expect(Scene.text("Pick the channel emails arrive in.")).toBeAbsent(),
			Scene.click(createInbox),
			Scene.Command.expectExact(
				CreateEmailInbox({
					organizationId,
					displayName: "Acme Support",
					supportAddress: null,
					hazelChannelId: supportChannel.id,
				}),
			),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Creating..." }))).toBeDisabled(),
			Scene.Command.resolve(CreateEmailInbox, Message.SucceededCreateEmailInbox({ inbox: created })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Email inbox created") }),
			),
			Scene.expect(Scene.within(dialog, Scene.text("Acme Support is ready"))).toExist(),
			Scene.expect(Scene.within(dialog, Scene.text("acme-support-7f3k@in.hazel.sh"))).toExist(),
			Scene.expect(Scene.within(dialog, Scene.text("Google Workspace"))).toExist(),
			Scene.expect(Scene.within(dialog, Scene.text("Microsoft 365"))).toExist(),
			Scene.Command.resolve(
				ListConnections,
				Message.SucceededListConnections({
					organizationId,
					connections: [connection],
					emailInboxes: [created],
				}),
			),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Done" }))),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
		)
	})
})

describe("manage an inbox", () => {
	test("Edit saves the name and support address", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([emailInbox])),
			addTriggerMounted,
			Scene.click(Scene.role("button", { name: "Edit inbox" })),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Channel"))).toBeAbsent(),
			Scene.type(nameInput, "Acme Help"),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Save" }))),
			Scene.Command.expectExact(
				UpdateEmailInbox({
					organizationId,
					syncConnectionId: emailInbox.id,
					displayName: "Acme Help",
					supportAddress: "support@acme.com",
				}),
			),
			Scene.Command.resolve(UpdateEmailInbox, Message.SucceededUpdateEmailInbox()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Inbox updated") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.Command.resolve(
				ListConnections,
				Message.SucceededListConnections({
					organizationId,
					connections: [connection],
					emailInboxes: [{ ...emailInbox, displayName: "Acme Help" }],
				}),
			),
			Scene.expect(Scene.text("Acme Help")).toExist(),
		)
	})

	test("Setup guide reopens the forwarding steps", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([emailInbox])),
			addTriggerMounted,
			Scene.click(Scene.role("button", { name: "Setup guide" })),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Set up Acme Support"))).toExist(),
			Scene.expect(Scene.within(dialog, Scene.text("Google Workspace"))).toExist(),
		)
	})

	test("Remove asks first, then removes the inbox", () => {
		Scene.scene(
			config,
			Scene.given(loadedWith([emailInbox])),
			addTriggerMounted,
			Scene.click(Scene.role("button", { name: "Remove inbox" })),
			portalModalMounted,
			Scene.expect(Scene.within(dialog, Scene.text("Acme Support"))).toExist(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Remove inbox" }))),
			Scene.Command.expectExact(RemoveEmailInbox({ organizationId, syncConnectionId: emailInbox.id })),
			Scene.Command.resolve(RemoveEmailInbox, Message.SucceededRemoveEmailInbox()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Inbox removed") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.AcquireResources),
			Scene.expect(Scene.text("No inboxes yet.")).toExist(),
			Scene.Command.resolve(
				ListConnections,
				Message.SucceededListConnections({
					organizationId,
					connections: [connection],
					emailInboxes: [],
				}),
			),
		)
	})
})
