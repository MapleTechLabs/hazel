import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import { init, UninstallBot, update } from "./update"

const botId = Schema.decodeSync(BotId)("00000000-0000-4000-8000-000000000001")
const initial = init({ _tag: "SettingsIntegrationsInstalled", orgSlug: "hazel" }).model
const toast = {
	intent: "error" as const,
	title: "Application not found",
	description: "This application may have already been uninstalled.",
}

describe("installed apps", () => {
	test("Uninstall sends bot.uninstall for the bot and toasts the failure", () => {
		story(
			update,
			given(initial),
			message(Message.ClickedUninstall({ botId })),
			Command.expectExact(UninstallBot({ botId })),
			Command.resolve(UninstallBot, Message.FailedUninstallBot({ toast })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
		)
	})
})

describe("installed apps outcomes", () => {
	test("a successful uninstall toasts; the live query removes the card", () => {
		story(
			update,
			given(initial),
			message(Message.ClickedUninstall({ botId })),
			Command.resolve(UninstallBot, Message.SucceededUninstallBot()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Application uninstalled successfully", description: null },
				}),
			),
		)
	})

	test("Browse Marketplace and Install by ID route out of the page", () => {
		story(
			update,
			given(initial),
			message(Message.ClickedBrowseMarketplace()),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: "/hazel/settings/integrations/marketplace", replace: false }),
			),
			message(Message.ClickedInstallById()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "InstallBotById" } })),
		)
	})

	// Bug: no pending state per bot, so a second Uninstall while one runs sends a second bot.uninstall.
	test.fails("a second Uninstall while uninstalling sends nothing", () => {
		story(
			update,
			given(initial),
			message(Message.ClickedUninstall({ botId })),
			Command.resolve(UninstallBot, Message.SucceededUninstallBot()),
		)
		const again = update(update(initial, Message.ClickedUninstall({ botId })).model, Message.ClickedUninstall({ botId }))
		expect(again.commands ?? []).toHaveLength(0)
	})
})
