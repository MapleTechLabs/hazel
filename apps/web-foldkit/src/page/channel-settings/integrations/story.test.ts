import "../document-stub"
import { ChannelId, ChannelWebhookId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import * as Modal from "../../../ui/modal"
import {
	ConnectProvider,
	CopyText,
	CreateWebhook,
	ListGitHub,
	ListWebhooks,
	RunProviderAction,
	RunRowAction,
	WaitForConfirmReset,
	WaitForCopiedReset,
} from "./command"
import { Message } from "./message"
import { init, update } from "./update"
import { sharedDefaults } from "../../test-shared"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const webhook = (n: number, name: string) => ({
	id: Schema.decodeSync(ChannelWebhookId)(uuid(n)),
	name,
	avatarUrl: null,
	tokenSuffix: "a1b2",
	isEnabled: true,
	lastUsedAtMs: null,
})
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}
const run = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const initial = init({ _tag: "ChannelSettingsIntegrations", orgSlug: "hazel", channelId })
const ci = webhook(2, "CI notifications")
const openStatus = webhook(3, "OpenStatus")
const loaded = run(initial.model, Message.SucceededListWebhooks({ webhooks: [ci, openStatus] })).model

describe("channel integrations", () => {
	test("mount lists the webhooks and RSS feeds; menus exist for custom webhooks only", () => {
		expect(initial.commands?.map((command) => command.name)).toEqual(["ListWebhooks", "ListRss"])
		expect(loaded.rowMenus.map((menu) => menu.id)).toEqual([`webhook-${ci.id}`])
	})

	test("Disable from a webhook menu updates it, toasts, and reloads the list", () => {
		const menu = (menuMessage: Menu.Message) =>
			Message.GotRowMenuMessage({ kind: "webhook", id: ci.id, message: menuMessage })
		story(
			run,
			given(loaded),
			message(menu(Menu.Message.PressedTrigger({ pointerType: "mouse" }))),
			Command.resolveAll(),
			message(menu(Menu.Message.ClickedItem({ key: "toggle" }))),
			Command.resolveAll(),
			model((current) => expect(current.togglingRowIds).toEqual([ci.id])),
			Command.resolve(
				RunRowAction,
				Message.SucceededRowAction({
					kind: "webhook",
					id: ci.id,
					successMessage: "Webhook disabled",
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Webhook disabled", description: null },
				}),
			),
			model((current) => expect(current.webhooks.isLoading).toBe(true)),
			Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ webhooks: [] })),
		)
	})

	test("a provider's Delete asks to confirm for 3 seconds before deleting", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedDeleteProvider({ provider: "openstatus" })),
			model((current) => expect(current.providers.openstatus.confirmDelete).toBe(true)),
			Command.resolve(
				WaitForConfirmReset,
				Message.ElapsedConfirmDelay({ provider: "openstatus", version: 1 }),
			),
			model((current) => expect(current.providers.openstatus.confirmDelete).toBe(false)),
			message(Message.ClickedDeleteProvider({ provider: "openstatus" })),
			Command.resolve(
				WaitForConfirmReset,
				Message.ElapsedConfirmDelay({ provider: "openstatus", version: 1 }),
			),
			// A stale timeout (version 1) leaves the re-armed confirm (version 2) alone.
			model((current) => expect(current.providers.openstatus.confirmDelete).toBe(true)),
			message(Message.ClickedDeleteProvider({ provider: "openstatus" })),
			Command.resolve(
				RunProviderAction,
				Message.SucceededProviderAction({
					provider: "openstatus",
					successMessage: "OpenStatus disconnected",
					isDelete: true,
				}),
			),
			Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ webhooks: [ci] })),
			model((current) => expect(current.providers.openstatus.confirmDelete).toBe(false)),
		)
	})
})

describe("list failure", () => {
	test("mount sends channelWebhook.list and rssSubscription.list for the channel", () => {
		expect(initial.commands).toMatchObject([
			{ name: "ListWebhooks", args: { channelId } },
			{ name: "ListRss", args: { channelId } },
		])
	})

	test("a failed webhook list stops loading and toasts", () => {
		story(
			run,
			given(initial.model),
			message(Message.FailedList({ list: "webhooks", title: "Channel not found", description: null })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Channel not found", description: null },
				}),
			),
			model((current) => expect(current.webhooks.isLoading).toBe(false)),
		)
	})
})

const rowMenu = (menuMessage: Menu.Message) =>
	Message.GotRowMenuMessage({ kind: "webhook", id: ci.id, message: menuMessage })
/** The custom webhook's menu opened and "Delete" picked: the confirm dialog is open. */
const confirming = [
	Menu.Message.PressedTrigger({ pointerType: "mouse" }),
	Menu.Message.ClickedItem({ key: "remove" }),
].reduce((current, next) => run(current, rowMenu(next)).model, loaded)

describe("row removal", () => {
	test("Delete from the menu opens the confirm dialog, and confirming deletes and reloads", () => {
		expect(confirming.confirmTarget).toEqual({ kind: "webhook", id: ci.id })
		expect(confirming.confirmModal.isOpen).toBe(true)
		story(
			run,
			given(confirming),
			message(Message.ClickedConfirmRemove()),
			Command.expectExact(RunRowAction({ kind: "webhook", id: ci.id, isEnabled: null })),
			model((current) => expect(current.isConfirmPending).toBe(true)),
			Command.resolve(
				RunRowAction,
				Message.SucceededRowAction({ kind: "webhook", id: ci.id, successMessage: "Webhook deleted" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Webhook deleted", description: null },
				}),
			),
			model((current) => {
				expect(current.confirmModal.isOpen).toBe(false)
				expect(current.isConfirmPending).toBe(false)
				expect(current.confirmTarget).toBeNull()
			}),
			Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ webhooks: [openStatus] })),
		)
	})

	test("a failed delete closes the dialog and toasts, without reloading", () => {
		story(
			run,
			given(confirming),
			message(Message.ClickedConfirmRemove()),
			Command.resolve(
				RunRowAction,
				Message.FailedRowAction({
					kind: "webhook",
					id: ci.id,
					title: "Webhook not found",
					description: null,
				}),
			),
			Command.expectNone(),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Webhook not found", description: null },
				}),
			),
			model((current) => expect(current.confirmModal.isOpen).toBe(false)),
		)
	})

	test("a second confirm while deleting sends nothing", () => {
		const pending = run(confirming, Message.ClickedConfirmRemove()).model
		story(run, given(pending), message(Message.ClickedConfirmRemove()), Command.expectNone())
	})

	// Bug: dismissing the dialog mid-delete clears confirmTarget, so settleRowAction never resets isConfirmPending.
	test.fails("Escape while a delete runs does not wedge the next removal", () => {
		const pending = run(confirming, Message.ClickedConfirmRemove()).model
		const escaped = run(
			pending,
			Message.GotConfirmModalMessage({ message: Modal.Message.PressedEscape() }),
		).model
		const settled = run(
			escaped,
			Message.SucceededRowAction({ kind: "webhook", id: ci.id, successMessage: "Webhook deleted" }),
		).model
		const reopened = run(settled, rowMenu(Menu.Message.PressedTrigger({ pointerType: "mouse" }))).model
		const again = run(reopened, rowMenu(Menu.Message.ClickedItem({ key: "remove" }))).model
		expect(run(again, Message.ClickedConfirmRemove()).commands ?? []).toHaveLength(1)
	})
})

describe("provider cards", () => {
	test("Connect creates the webhook, keeps the token, toasts, and reloads", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedConnectProvider({ provider: "railway" })),
			Command.expectExact(ConnectProvider({ channelId, provider: "railway" })),
			model((current) => expect(current.providers.railway.isCreating).toBe(true)),
			Command.resolve(
				ConnectProvider,
				Message.SucceededConnectProvider({ provider: "railway", token: "tok" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Railway connected", description: null },
				}),
			),
			model((current) => {
				expect(current.providers.railway).toMatchObject({ isCreating: false, createdToken: "tok" })
				expect(current.webhooks.isLoading).toBe(true)
			}),
			Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ webhooks: [ci, openStatus] })),
			message(Message.ClickedDismissProviderToken({ provider: "railway" })),
			model((current) => expect(current.providers.railway.createdToken).toBeNull()),
		)
	})

	test("a failed connect re-enables Connect and toasts; a second click while connecting is ignored", () => {
		const connecting = run(loaded, Message.ClickedConnectProvider({ provider: "railway" })).model
		story(
			run,
			given(connecting),
			message(Message.ClickedConnectProvider({ provider: "railway" })),
			Command.expectNone(),
		)
		story(
			run,
			given(connecting),
			message(
				Message.FailedConnectProvider({
					provider: "railway",
					title: "Channel not found",
					description: null,
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Channel not found", description: null },
				}),
			),
			model((current) => expect(current.providers.railway.isCreating).toBe(false)),
		)
	})

	test("Disable sends the flipped flag for the provider's webhook", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedToggleProvider({ provider: "openstatus" })),
			Command.expectExact(
				RunProviderAction({ provider: "openstatus", webhookId: openStatus.id, isEnabled: false }),
			),
			Command.resolve(
				RunProviderAction,
				Message.FailedProviderAction({
					provider: "openstatus",
					title: "Webhook not found",
					description: null,
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Webhook not found", description: null },
				}),
			),
		)
	})

	// Bug: ClickedToggleProvider has no in-flight state, so a double click sends two updates.
	test.fails("a second Disable click while the first runs sends nothing", () => {
		const toggling = run(loaded, Message.ClickedToggleProvider({ provider: "openstatus" }))
		expect(toggling.commands).toHaveLength(1)
		expect(
			run(toggling.model, Message.ClickedToggleProvider({ provider: "openstatus" })).commands ?? [],
		).toHaveLength(0)
	})

	test("toggle and delete do nothing for a provider that is not connected", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedToggleProvider({ provider: "railway" })),
			Command.expectNone(),
			message(Message.ClickedDeleteProvider({ provider: "railway" })),
			Command.expectNone(),
		)
	})

	test("the URL info button explains how to get a new URL", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedProviderUrlInfo()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "info",
						title: "Delete and reconnect to get a new URL",
						description: null,
					},
				}),
			),
		)
	})
})

const field = (name: "name" | "description" | "avatarUrl", value: string) =>
	Message.ChangedCreateField({ field: name, value })

describe("create webhook form", () => {
	test("creating sends the fields, shows the token once, toasts, and reloads", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedExpandCreateForm()),
			message(field("name", "Deploys")),
			message(field("description", "CI deploys")),
			message(Message.SubmittedCreateForm()),
			Command.expectExact(
				CreateWebhook({ channelId, name: "Deploys", description: "CI deploys", avatarUrl: "" }),
			),
			model((current) => expect(current.createForm.isSubmitting).toBe(true)),
			Command.resolve(
				CreateWebhook,
				Message.SucceededCreateWebhook({ token: "secret", webhookUrl: "https://hook" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Webhook created successfully", description: null },
				}),
			),
			model((current) =>
				expect(current.createForm.created).toEqual({ token: "secret", webhookUrl: "https://hook" }),
			),
			Command.resolve(ListWebhooks, Message.SucceededListWebhooks({ webhooks: [ci, openStatus] })),
			message(Message.ClickedDismissToken()),
			model((current) => expect(current.createForm).toEqual(initial.model.createForm)),
		)
	})

	test("a short or empty name does not submit", () => {
		story(
			run,
			given(loaded),
			message(Message.SubmittedCreateForm()),
			Command.expectNone(),
			message(field("name", "a")),
			message(Message.SubmittedCreateForm()),
			Command.expectNone(),
		)
	})

	test("a failed create keeps the draft, re-enables submit, and toasts", () => {
		const submitting = [field("name", "Deploys"), Message.SubmittedCreateForm()].reduce(
			(current, next) => run(current, next).model,
			loaded,
		)
		story(run, given(submitting), message(Message.SubmittedCreateForm()), Command.expectNone())
		story(
			run,
			given(submitting),
			message(Message.FailedCreateWebhook({ title: "Channel not found", description: null })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Channel not found", description: null },
				}),
			),
			model((current) =>
				expect(current.createForm).toMatchObject({ name: "Deploys", isSubmitting: false }),
			),
		)
	})
})

describe("copy and GitHub", () => {
	const copy = {
		id: ci.id,
		value: "https://url",
		successMessage: "URL copied",
		failureMessage: "Failed to copy",
	}

	test("a copy shows its check for 2 seconds and toasts", () => {
		story(
			run,
			given(loaded),
			message(Message.ClickedCopy(copy)),
			// Matched by Definition: update passes the whole Message (with `_tag`) as the args.
			Command.expectExact(CopyText),
			Command.resolve(
				CopyText,
				Message.CompletedCopy({ id: ci.id, isCopied: true, toastTitle: "URL copied" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "URL copied", description: null },
				}),
			),
			model((current) => expect(current.copiedIds).toEqual([ci.id])),
			Command.resolve(WaitForCopiedReset, Message.ElapsedCopiedDelay({ id: ci.id })),
			model((current) => expect(current.copiedIds).toEqual([])),
		)
	})

	test("a failed copy toasts an error", () => {
		story(
			run,
			given(loaded),
			message(Message.CompletedCopy({ id: ci.id, isCopied: false, toastTitle: "Failed to copy" })),
			Command.expectNone(),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Failed to copy", description: null },
				}),
			),
		)
	})

	test("a live GitHub connection loads the subscriptions; Connect navigates to settings", () => {
		story(
			run,
			given(loaded),
			message(Message.UpdatedGitHubConnection({ isConnected: true })),
			Command.expectExact(ListGitHub({ channelId })),
			model((current) => expect(current.github.isLoading).toBe(true)),
			Command.resolve(ListGitHub, Message.SucceededListGitHub({ repos: [] })),
			message(Message.UpdatedGitHubConnection({ isConnected: true })),
			Command.expectNone(),
			message(Message.ClickedConnectGitHub()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					href: "/hazel/settings/integrations/github",
					replace: false,
				}),
			),
		)
	})
})
