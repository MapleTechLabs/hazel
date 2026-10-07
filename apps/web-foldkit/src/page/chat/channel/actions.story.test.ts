import { ChannelId, PinnedMessageId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	CopyText,
	CreateThread,
	GenerateThreadChannelId,
	GenerateThreadName,
	PinMessage,
	ToggleReaction,
	TrackEmojiUsage,
	UnpinMessage,
} from "../message-actions"
import * as Overlays from "../overlays"
import {
	ada,
	adaMessageId,
	channelId,
	graceMessageId,
	loadedModel,
	organizationId,
	updateWithShared,
} from "./fixtures.test-support"
import { Message, type Model } from "./model"
import * as Write from "./write"

/** Behavioral parity of the message actions (`useMessageActions` and `ChatProvider`). */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const out = (action: Overlays.MessageAction, messageId = graceMessageId) =>
	Overlays.OutMessage.RequestedMessageAction({ messageId, action })

describe("reactions", () => {
	test("a toolbar quick reaction counts the emoji and toggles through `messageReaction.toggle`", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedReaction({ messageId: graceMessageId, emoji: "👍" }))),
			Command.expectExact(
				TrackEmojiUsage({ emoji: "👍" }),
				ToggleReaction({ messageId: graceMessageId, channelId, emoji: "👍", userId: ada }),
			),
			Command.resolve(TrackEmojiUsage, ActionMessage.CompletedTrackEmojiUsage()),
			Command.resolve(ToggleReaction, ActionMessage.CompletedToggleReaction({ toast: null })),
		)
	})
})

describe("message actions", () => {
	test("Delete asks the root for the DeleteMessage modal (it runs `message.delete`)", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedDelete({ messageId: adaMessageId }))),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId: adaMessageId } })),
			Command.expectNone(),
		)
	})

	test("Copy writes the content and toasts", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedCopy({ messageId: graceMessageId }))),
			Command.expectExact(CopyText({ text: "Launch window confirmed" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Copied!",
						description: "Message content has been copied to your clipboard.",
					},
				}),
			),
			Command.resolve(CopyText, ActionMessage.CompletedCopyText()),
		)
	})

	test("Pin sends `pinnedMessage.create`; a pinned message unpins by its pin id", () => {
		const pinnedId = Schema.decodeSync(PinnedMessageId)("00000000-0000-4000-8000-000000005555")
		const pinned: Model = {
			...loadedModel(),
			pinned: [
				{
					pinnedId,
					messageId: graceMessageId,
					authorId: ada,
					author: null,
					content: "",
					createdAtMs: 0,
					updatedAtMs: null,
					pinnedAtMs: 0,
				},
			],
		}
		const pin = Write.handleOverlaysOut(loadedModel(), out("pin"))
		expect(pin.commands?.map((command) => [command.name, command.args])).toEqual([
			["PinMessage", { messageId: graceMessageId, channelId, userId: ada }],
		])
		const unpin = Write.handleOverlaysOut(pinned, out("pin"))
		expect(unpin.commands?.map((command) => [command.name, command.args])).toEqual([
			["UnpinMessage", { pinnedMessageId: pinnedId }],
		])
		expect(PinMessage.name).toBe("PinMessage")
		expect(UnpinMessage.name).toBe("UnpinMessage")
	})

	test("Reply in thread opens the panel on a fresh id, then `channel.createThread`", () => {
		const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000004444")
		const start = Write.handleOverlaysOut(loadedModel(), out("thread"))
		story(
			updateWithShared,
			given(start.model),
			message(Message.GotActionMessage({
				message: ActionMessage.CompletedGenerateThreadChannelId({ messageId: graceMessageId, threadChannelId }),
			})),
			model((current) => {
				expect(current.overlays.thread).toEqual({ threadChannelId, messageId: graceMessageId })
				expect(current.pendingThreadChannelId).toBe(threadChannelId)
				expect(current.threadDraft?.composer.placeholder).toBe("Reply in thread...")
			}),
			Command.expectExact(
				CreateThread({
					threadChannelId,
					messageId: graceMessageId,
					parentChannelId: channelId,
					organizationId,
					currentUserId: ada,
				}),
			),
			Command.resolve(CreateThread, ActionMessage.SucceededCreateThread({ threadChannelId })),
			model((current) => expect(current.pendingThreadChannelId).toBeNull()),
			message(Message.ClickedGenerateThreadName()),
			Command.expectExact(GenerateThreadName({ channelId: threadChannelId })),
			Command.resolve(GenerateThreadName, ActionMessage.CompletedGenerateThreadName({ threadChannelId, toast: null })),
			message(Message.ClickedRenameThread()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "RenameThread", threadId: threadChannelId } })),
		)
		expect(start.commands?.map((command) => command.name)).toEqual([GenerateThreadChannelId.name])
	})
})

describe("composer pickers", () => {
	test("an emoji from the picker goes into the editor; a custom one as an inline emoji", () => {
		const editorId = `composer-${channelId}`
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.GotDraftMessage({ message: Draft.Message.SelectedEmoji({ emoji: "🎉", label: "party", imageUrl: null }) })),
			Command.expectExact(EditorCommands.InsertEditorText({ editorId, text: "🎉" })),
			Command.resolve(EditorCommands.InsertEditorText, Composer.Message.CompletedInsertEditorText()),
			message(
				Message.GotDraftMessage({
					message: Draft.Message.SelectedEmoji({ emoji: "custom:shipit", label: "shipit", imageUrl: "/r2/shipit.png" }),
				}),
			),
			Command.expectExact(EditorCommands.InsertCustomEmoji({ editorId, name: "shipit", imageUrl: "/r2/shipit.png" })),
			Command.resolve(EditorCommands.InsertCustomEmoji, Composer.Message.CompletedInsertCustomEmoji()),
		)
	})
})

