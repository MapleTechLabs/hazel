// @vitest-environment jsdom
import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { botId } from "../../../../test/pages-integrations-fixtures"
import { reasonToast } from "../../../../data/actions"
import { PageOutMessage } from "../../../out-message"
import { Message } from "./message"
import { makeShared, storyUpdate } from "../../../../test/pages-fixtures"
import { InstallBot, init, update as pageUpdate } from "./update"

const update = storyUpdate(pageUpdate, makeShared())

/** Marketplace installs: per-bot pending state and its guard. */

const otherBotId = Schema.decodeSync(BotId)("00000000-0000-4000-8000-000000000031")

describe("marketplace installs", () => {
	test("two bots install independently; finishing one keeps the other pending", () => {
		story(
			update,
			given(init().model),
			message(Message.ClickedInstall({ botId })),
			Command.resolve(InstallBot, Message.FailedInstallBot({ botId, reason: "RateLimited" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("RateLimited") })),
			message(Message.ClickedInstall({ botId: otherBotId })),
			model((current) => expect(current.installingBotIds).toEqual([otherBotId])),
			Command.resolve(InstallBot, Message.SucceededInstallBot({ botId: otherBotId })),
			model((current) => expect(current.installingBotIds).toEqual([])),
		)
	})

	test("a second Install while installing sends no second install", () => {
		story(
			update,
			given(init().model),
			message(Message.ClickedInstall({ botId })),
			Command.resolve(InstallBot, Message.SucceededInstallBot({ botId })),
		)
		const pending = update(
			{ ...init().model, installingBotIds: [botId] },
			Message.ClickedInstall({ botId }),
		)
		expect(pending.commands ?? []).toHaveLength(0)
	})
})
