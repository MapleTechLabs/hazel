import "../document-stub"
import { ChannelId, ChannelWebhookId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { ListWebhooks, RunProviderAction, RunRowAction, WaitForConfirmReset } from "./command"
import { Message } from "./message"
import { init, update } from "./update"

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
