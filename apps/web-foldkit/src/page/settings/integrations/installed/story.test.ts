import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, story } from "foldkit/story"
import { describe, test } from "vitest"
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
