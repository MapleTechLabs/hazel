// @vitest-environment jsdom
import { BotId } from "@hazel/schema"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as DropZone from "../../page/shared/drop-zone"
import { ModalOutMessage } from "../out-message"
import { initBotForm } from "./bot-form"
import { Message, OpenAvatarPicker, UploadBotAvatar, update } from "./edit-bot"
import { initFrame } from "./frame"

const botId = BotId.make("00000000-0000-4000-8000-000000000000")
const initial = {
	frame: initFrame("edit-bot-modal"),
	botId,
	botName: "Maple",
	avatarUrl: null,
	isUploadingAvatar: false,
	dropZone: DropZone.init(),
	...initBotForm({ name: "Maple", description: "", scopes: [], isPublic: true }),
}
const png = new File(["png"], "maple.png", { type: "image/png" })
const avatarUrl = "https://cdn.example.com/bots/maple.png"
const failure = { intent: "error" as const, title: "Upload failed", description: null }

describe("edit bot avatar", () => {
	test("clicking the avatar opens the file picker", () => {
		story(
			update,
			given(initial),
			message(Message.ClickedAvatar()),
			Command.expectExact(OpenAvatarPicker()),
			Command.resolve(OpenAvatarPicker, Message.CompletedOpenAvatarPicker()),
		)
	})

	test("a picked image uploads, then the dialog shows it", () => {
		story(
			update,
			given(initial),
			message(Message.SelectedAvatarFiles({ files: [png] })),
			Command.expectExact(UploadBotAvatar),
			model((current) => expect(current.isUploadingAvatar).toBe(true)),
			Command.resolve(UploadBotAvatar, Message.SucceededUploadAvatar({ avatarUrl })),
			model((current) => {
				expect(current.isUploadingAvatar).toBe(false)
				expect(current.avatarUrl).toBe(avatarUrl)
			}),
		)
	})

	test("a dropped image uploads and clears the drop highlight", () => {
		story(
			update,
			given({ ...initial, dropZone: { isOver: true, pageDragDepth: 0 } }),
			message(Message.SelectedAvatarFiles({ files: [png] })),
			Command.expectExact(UploadBotAvatar),
			model((current) => expect(current.dropZone.isOver).toBe(false)),
			Command.resolve(UploadBotAvatar, Message.SucceededUploadAvatar({ avatarUrl })),
		)
	})

	test("a pick during an upload is ignored", () => {
		story(
			update,
			given({ ...initial, isUploadingAvatar: true }),
			message(Message.SelectedAvatarFiles({ files: [png] })),
			Command.expectNone(),
		)
	})

	test("a failed upload keeps the old avatar and shows the toast", () => {
		story(
			update,
			given(initial),
			message(Message.SelectedAvatarFiles({ files: [png] })),
			Command.resolve(UploadBotAvatar, Message.FailedUploadAvatar({ toast: failure })),
			expectOutMessage(ModalOutMessage.RequestedToast({ toast: failure })),
			model((current) => {
				expect(current.isUploadingAvatar).toBe(false)
				expect(current.avatarUrl).toBe(null)
			}),
		)
	})
})
