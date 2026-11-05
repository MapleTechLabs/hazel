import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import { PageOutMessage } from "../../out-message"
import { ActionMessage, CopyText, PinMessage } from "../message-actions"
import * as EmojiPicker from "../../../emoji-picker/picker"
import {
	adaMessageId,
	channelId,
	graceMessageId,
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "./fixtures.test-support"
import { DeleteMessageNow, FocusMessage, messageKeyOf } from "./message-keys"
import { Message, type MessageKey, type Model } from "./model"

/**
 * Discord's message keyboard: Shift+Tab from the composer onto the messages, the arrows between
 * them, Escape back, and E / R / T / P / Delete / + / Mod+C on the focused one. Ada (the signed-in
 * user) wrote the newest message, Grace the one above it.
 */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const editorId = `composer-${channelId}`
const loaded = (): Model => updateWithShared(loadedModel(), loadedMessages(messages)).model
const key = (messageId: typeof adaMessageId, pressed: MessageKey) =>
	Message.PressedMessageKey({ messageId, key: pressed })
const shiftTab = Message.GotDraftMessage({
	message: Draft.Message.GotComposerMessage({ message: Composer.Message.PressedShiftTab() }),
})
const focusesComposer = [
	Command.expectExact(EditorCommands.FocusEditor({ editorId })),
	Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
] as const
const focuses = (messageId: typeof adaMessageId) =>
	[
		Command.expectExact(FocusMessage({ messageId })),
		Command.resolve(FocusMessage, Message.CompletedFocusMessage()),
		model((current: Model) => expect(current.focusedMessageId).toBe(messageId)),
	] as const

describe("into and out of the messages", () => {
	test("Shift+Tab in the composer focuses the newest message", () => {
		story(updateWithShared, given(loaded()), message(shiftTab), ...focuses(adaMessageId))
	})

	test("Shift+Tab goes back to the message the keyboard was last on", () => {
		story(
			updateWithShared,
			given({ ...loaded(), focusedMessageId: graceMessageId }),
			message(shiftTab),
			...focuses(graceMessageId),
		)
	})

	test("Escape on a message returns to the composer", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "BackToComposer")),
			...focusesComposer,
		)
	})

	test("a message focused by a click or Tab is remembered", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(Message.FocusedMessage({ messageId: graceMessageId })),
			model((current) => expect(current.focusedMessageId).toBe(graceMessageId)),
		)
	})
})

describe("arrows", () => {
	test("ArrowUp moves to the message above", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(adaMessageId, "Previous")),
			...focuses(graceMessageId),
		)
	})

	test("ArrowUp on the oldest loaded message stays", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Previous")),
			Command.expectNone(),
		)
	})

	test("ArrowDown moves to the message below", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Next")),
			...focuses(adaMessageId),
		)
	})

	test("ArrowDown past the newest message returns to the composer", () => {
		story(updateWithShared, given(loaded()), message(key(adaMessageId, "Next")), ...focusesComposer)
	})
})

describe("actions on the focused message", () => {
	test("E edits your own message", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(adaMessageId, "Edit")),
			model((current) => expect(Draft.editingMessageIdOf(current.draft)).toBe(adaMessageId)),
			Command.expectExact(
				EditorCommands.SetEditorContent({ editorId, markdown: "Shipped the onboarding copy" }),
			),
			Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
		)
	})

	test("E on someone else's message does nothing", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Edit")),
			Command.expectNone(),
			model((current) => expect(Draft.editingMessageIdOf(current.draft)).toBeNull()),
		)
	})

	test("R replies to it and puts the keyboard in the composer", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Reply")),
			model((current) => expect(Draft.replyToMessageIdOf(current.draft)).toBe(graceMessageId)),
			...focusesComposer,
		)
	})

	test("P pins it", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Pin")),
			Command.expectHas(PinMessage),
			Command.resolve(PinMessage, ActionMessage.SucceededPinMessage()),
		)
	})

	test("Delete asks to delete your own message; Shift+Delete deletes it without asking", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(adaMessageId, "Delete")),
			expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId: adaMessageId } }),
			),
		)
		story(
			updateWithShared,
			given(loaded()),
			message(key(adaMessageId, "DeleteNow")),
			Command.expectExact(DeleteMessageNow({ messageId: adaMessageId })),
			Command.resolve(DeleteMessageNow, Message.SucceededDeleteMessageNow()),
		)
	})

	test("Delete on someone else's message does nothing", () => {
		story(updateWithShared, given(loaded()), message(key(graceMessageId, "Delete")), Command.expectNone())
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "DeleteNow")),
			Command.expectNone(),
		)
	})

	test("+ opens the reaction picker for it", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "React")),
			model((current) => expect(current.overlays.open._tag).toBe("ReactionModal")),
			Command.expectExact(EmojiPicker.LoadEmojiData),
			Command.resolve(
				EmojiPicker.LoadEmojiData,
				EmojiPicker.Message.FailedLoadEmojiData({ reason: "Offline" }),
			),
		)
	})

	test("Mod+C copies its text", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(key(graceMessageId, "Copy")),
			Command.expectExact(CopyText({ text: "Launch window confirmed", content: "MessageText" })),
			Command.resolve(CopyText, ActionMessage.SucceededCopyText({ content: "MessageText" })),
		)
	})
})

describe("messageKeyOf", () => {
	const press = (
		pressed: string,
		modifiers: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {},
	) =>
		messageKeyOf({
			key: pressed,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			...modifiers,
		})

	test("Discord's keys", () => {
		expect(press("ArrowUp")).toBe("Previous")
		expect(press("ArrowDown")).toBe("Next")
		expect(press("Escape")).toBe("BackToComposer")
		expect(press("e")).toBe("Edit")
		expect(press("r")).toBe("Reply")
		expect(press("t")).toBe("Thread")
		expect(press("p")).toBe("Pin")
		expect(press("Delete")).toBe("Delete")
		expect(press("Backspace")).toBe("Delete")
		expect(press("Delete", { shiftKey: true })).toBe("DeleteNow")
		expect(press("+", { shiftKey: true })).toBe("React")
		expect(press("c", { ctrlKey: true })).toBe("Copy")
		expect(press("c", { metaKey: true })).toBe("Copy")
	})

	test("anything else keeps its default: Alt combos, other Mod combos, Shift+letters, plain letters", () => {
		expect(press("ArrowUp", { altKey: true })).toBeNull()
		expect(press("e", { ctrlKey: true })).toBeNull()
		expect(press("E", { shiftKey: true })).toBeNull()
		expect(press("x")).toBeNull()
		expect(press("Enter")).toBeNull()
	})
})
