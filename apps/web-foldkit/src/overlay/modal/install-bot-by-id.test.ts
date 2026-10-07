// @vitest-environment jsdom
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { ModalOutMessage } from "../out-message"
import { initFrame } from "./frame"
import { InstallBotById, Message, update } from "./install-bot-by-id"

const botId = "00000000-0000-4000-8000-000000000000"
const initial = {
	frame: initFrame("install-bot-by-id-modal"),
	installBotId: "",
	installError: null,
	isInstalling: false,
}
const toast = { intent: "error" as const, title: "Application not found", description: null }

describe("install by ID", () => {
	test("submitting sends bot.installById with the trimmed ID and keeps the dialog open on failure", () => {
		story(
			update,
			given(initial),
			message(Message.ChangedBotId({ value: ` ${botId} ` })),
			message(Message.SubmittedForm()),
			Command.expectExact(InstallBotById({ botId })),
			model((current) => expect(current.isInstalling).toBe(true)),
			Command.resolve(
				InstallBotById,
				Message.FailedInstallBot({
					toast,
					installError: "Application not found. Please check the ID and try again.",
				}),
			),
			expectOutMessage(ModalOutMessage.RequestedToast({ toast })),
			model((current) => {
				expect(current.isInstalling).toBe(false)
				expect(current.installError).toBe("Application not found. Please check the ID and try again.")
			}),
		)
	})
})
