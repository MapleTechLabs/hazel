// @vitest-environment jsdom
import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { failureToastFixture } from "../../../../test/pages-fixtures"
import { botId } from "../../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import { InstallBot, init, update } from "./update"

/** Marketplace installs: per-bot pending state and its guard. */

const otherBotId = Schema.decodeSync(BotId)("00000000-0000-4000-8000-000000000031")

describe("marketplace installs", () => {
	test("two bots install independently; finishing one keeps the other pending", () => {
		story(
			update,
			given(init().model),
			message(Message.ClickedInstall({ botId })),
			Command.resolve(InstallBot, Message.FailedInstallBot({ botId, toast: failureToastFixture })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			message(Message.ClickedInstall({ botId: otherBotId })),
			model((current) => expect(current.installingBotIds).toEqual([otherBotId])),
			Command.resolve(InstallBot, Message.SucceededInstallBot({ botId: otherBotId })),
			model((current) => expect(current.installingBotIds).toEqual([])),
		)
	})

	// Bug: ClickedInstall has no guard in update; only the disabled button stops a second install.
	test.fails("a second Install while installing sends no second install", () => {
		story(
			update,
			given(init().model),
			message(Message.ClickedInstall({ botId })),
			Command.resolve(InstallBot, Message.SucceededInstallBot({ botId })),
		)
		const pending = update({ ...init().model, installingBotIds: [botId] }, Message.ClickedInstall({ botId }))
		expect(pending.commands ?? []).toHaveLength(0)
	})
})
