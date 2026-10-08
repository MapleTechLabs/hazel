// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../data/actions"
import { feedOf, webhookOf } from "../../../test/pages-channel-settings-fixtures"
import {
	channelId,
	failureToastFixture,
	makeShared,
	pageScene,
	portalModalMounted,
} from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { PageOutMessage } from "../../out-message"
import {
	ConnectProvider,
	CreateWebhook,
	ListRss,
	ListWebhooks,
	RunProviderAction,
	RunRowAction,
	WaitForConfirmReset,
} from "./command"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The channel integrations tab through its view: provider cards and the custom webhook form. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const initial = init({ _tag: "ChannelSettingsIntegrations", orgSlug: "hazel", channelId }).model
const ci = webhookOf(2, "CI notifications")
const openStatus = webhookOf(3, "OpenStatus")
const listed = (...webhooks: ReadonlyArray<typeof ci>) =>
	[
		Message.SucceededListWebhooks({ version: 1, webhooks }),
		Message.SucceededListRss({ version: 1, feeds: [] }),
	].reduce((current, next) => update(current, next, shared).model, initial)
const nameInput = Scene.label("Name")
const createButton = Scene.role("button", { name: /Create webhook/ })
const menuMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())

describe("lists", () => {
	test("the webhook list loads, then shows its empty state", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.expect(Scene.text("No webhooks yet")).toBeAbsent(),
		)
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.expect(Scene.text("No webhooks yet")).toExist(),
			Scene.expect(Scene.text("No RSS feeds subscribed")).toExist(),
			Scene.expect(Scene.role("button", { name: "Connect GitHub" })).toExist(),
		)
	})
})

describe("create webhook", () => {
	test("create, see the token once, and Done resets the form", () => {
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.click(createButton),
			Scene.expect(createButton).toBeEnabled(),
			Scene.type(nameInput, "Deploys"),
			Scene.click(createButton),
			Scene.Command.expectExact(
				CreateWebhook({ channelId, name: "Deploys", description: "", avatarUrl: "" }),
			),
			Scene.expect(Scene.role("button", { name: "Creating..." })).toBeDisabled(),
			Scene.Command.resolve(
				CreateWebhook,
				Message.SucceededCreateWebhook({ token: "secret", webhookUrl: "https://hook" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Webhook created successfully") }),
			),
			Scene.expect(
				Scene.text("Make sure to copy your token now. You won't be able to see it again!"),
			).toExist(),
			Scene.expect(Scene.displayValue("secret")).toHaveAttr("type", "password"),
			Scene.Command.resolve(
				ListWebhooks,
				Message.SucceededListWebhooks({ version: 2, webhooks: [ci] }),
			),
			menuMounted,
			Scene.expect(Scene.text("CI notifications")).toExist(),
			Scene.click(Scene.role("button", { name: "Show token" })),
			Scene.expect(Scene.displayValue("secret")).toHaveAttr("type", "text"),
			Scene.expect(Scene.role("button", { name: "Hide token" })).toHaveAttr("aria-pressed", "true"),
			Scene.click(Scene.role("button", { name: "Done" })),
			Scene.expect(Scene.displayValue("secret")).toBeAbsent(),
			Scene.expect(nameInput).toBeAbsent(),
			Scene.expect(createButton).toExist(),
		)
	})

	test("a one-character name is invalid and disables Create", () => {
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.click(createButton),
			Scene.type(nameInput, "a"),
			Scene.expect(nameInput).toHaveAttr("aria-invalid", "true"),
			Scene.expect(createButton).toBeDisabled(),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.expect(nameInput).toBeAbsent(),
		)
	})

	test("a failed create keeps the typed name and toasts", () => {
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.click(createButton),
			Scene.type(nameInput, "Deploys"),
			Scene.submit(Scene.selector("form")),
			Scene.Command.resolve(
				CreateWebhook,
				Message.FailedCreateWebhook({
					title: failureToastFixture.title,
					description: failureToastFixture.description,
				}),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(nameInput).toHaveValue("Deploys"),
			Scene.expect(createButton).toBeEnabled(),
		)
	})
})

const connectOpenStatus = Scene.nth(Scene.all.role("button", { name: "Connect" }), 0)

describe("provider cards", () => {
	test("Connect shows the one-time URL, then the active card", () => {
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.click(connectOpenStatus),
			Scene.Command.expectExact(ConnectProvider({ channelId, provider: "openstatus" })),
			Scene.expect(Scene.role("button", { name: "Connecting..." })).toBeDisabled(),
			Scene.Command.resolve(
				ConnectProvider,
				Message.SucceededConnectProvider({ provider: "openstatus", token: "tok" }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("OpenStatus connected") }),
			),
			Scene.Command.resolve(
				ListWebhooks,
				Message.SucceededListWebhooks({ version: 2, webhooks: [openStatus] }),
			),
			Scene.expect(Scene.text("Copy this URL now. The token won't be shown again.")).toExist(),
			Scene.click(Scene.role("button", { name: "Done" })),
			Scene.expect(Scene.text("Copy this URL now. The token won't be shown again.")).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Disable" })).toExist(),
		)
	})

	test("a failed Connect re-enables the button and toasts", () => {
		Scene.scene(
			config,
			Scene.given(listed()),
			Scene.click(connectOpenStatus),
			Scene.Command.resolve(
				ConnectProvider,
				Message.FailedConnectProvider({
					provider: "openstatus",
					title: failureToastFixture.title,
					description: failureToastFixture.description,
				}),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(connectOpenStatus).toBeEnabled(),
		)
	})

	test("Disable updates the webhook and the card shows it disabled after the reload", () => {
		Scene.scene(
			config,
			Scene.given(listed(openStatus)),
			Scene.click(Scene.role("button", { name: "Disable" })),
			Scene.Command.expectExact(
				RunProviderAction({ provider: "openstatus", webhookId: openStatus.id, isEnabled: false }),
			),
			Scene.Command.resolve(
				RunProviderAction,
				Message.SucceededProviderAction({
					provider: "openstatus",
					successMessage: "OpenStatus disabled",
					isDelete: false,
				}),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("OpenStatus disabled") }),
			),
			Scene.Command.resolve(
				ListWebhooks,
				Message.SucceededListWebhooks({ version: 2, webhooks: [webhookOf(3, "OpenStatus", false)] }),
			),
			Scene.expect(Scene.role("button", { name: "Enable" })).toExist(),
			Scene.expect(Scene.text("Disabled")).toExist(),
		)
	})

	test("Delete arms a 3 second confirm that lapses back", () => {
		Scene.scene(
			config,
			Scene.given(listed(openStatus)),
			Scene.click(Scene.role("button", { name: "Delete" })),
			Scene.expect(Scene.role("button", { name: "Confirm?" })).toExist(),
			Scene.Command.resolve(
				WaitForConfirmReset,
				Message.ElapsedConfirmDelay({ provider: "openstatus", version: 1 }),
			),
			Scene.expect(Scene.role("button", { name: "Delete" })).toExist(),
		)
	})
})

// a11y: the row menu trigger is an icon-only button with no accessible name, so it is found by aria-haspopup.
const rowMenuTrigger = Scene.selector('[aria-haspopup="true"]')
const portalMenuMounted = Scene.Mount.resolve({ name: "PortalMenu" }, Menu.Message.CompletedPortalMenu())
const confirmDialog = Scene.role("alertdialog")

describe("row removal", () => {
	test("Delete from a webhook menu asks to confirm, then deletes and reloads", () => {
		Scene.scene(
			config,
			Scene.given(listed(ci)),
			menuMounted,
			Scene.pointerDown(rowMenuTrigger, { pointerType: "mouse", button: 0 }),
			Scene.Command.resolveAll(),
			portalMenuMounted,
			Scene.click(Scene.role("menuitem", { name: "Delete" })),
			Scene.Command.resolveAll(),
			Scene.Mount.expectEnded({ name: "PortalMenu" }),
			portalModalMounted,
			Scene.expect(Scene.within(confirmDialog, Scene.text("Delete webhook?"))).toExist(),
			Scene.click(Scene.within(confirmDialog, Scene.role("button", { name: "Delete" }))),
			Scene.Command.expectExact(RunRowAction({ kind: "webhook", id: ci.id, isEnabled: null })),
			Scene.Command.resolve(
				RunRowAction,
				Message.SucceededRowAction({ kind: "webhook", id: ci.id, successMessage: "Webhook deleted" }),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Webhook deleted") })),
			Scene.expect(confirmDialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ version: 2, webhooks: [] })),
			Scene.expect(Scene.text("No webhooks yet")).toExist(),
		)
	})
})

describe("rss feeds", () => {
	test("Pause from a feed menu pauses it and the reload shows the Paused badge", () => {
		const feed = feedOf(30, "Hazel blog")
		const withFeed = update(
			listed(),
			Message.SucceededListRss({ version: 1, feeds: [feed] }),
			shared,
		).model
		Scene.scene(
			config,
			Scene.given(withFeed),
			menuMounted,
			Scene.expect(Scene.text("1 feed")).toExist(),
			Scene.pointerDown(rowMenuTrigger, { pointerType: "mouse", button: 0 }),
			Scene.Command.resolveAll(),
			portalMenuMounted,
			Scene.click(Scene.role("menuitem", { name: "Pause" })),
			Scene.Command.resolveAll(),
			Scene.Mount.expectEnded({ name: "PortalMenu" }),
			Scene.Command.expectExact(RunRowAction({ kind: "rss", id: feed.id, isEnabled: false })),
			Scene.Command.resolve(
				RunRowAction,
				Message.SucceededRowAction({ kind: "rss", id: feed.id, successMessage: "Feed paused" }),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Feed paused") })),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.Command.resolve(
				ListRss,
				Message.SucceededListRss({ version: 2, feeds: [{ ...feed, isEnabled: false }] }),
			),
			menuMounted,
			Scene.expect(Scene.text("Paused")).toExist(),
		)
	})
})
