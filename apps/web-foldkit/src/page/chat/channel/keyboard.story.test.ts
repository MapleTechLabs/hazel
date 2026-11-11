import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import { PageOutMessage } from "../../out-message"
import {
	adaMessageId,
	channelId,
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "./fixtures.test-support"
import { Message } from "./model"
import { ClearChannelNotifications } from "./clear-notifications"
import * as MessageList from "../../../mount/message-list"
import * as EmojiPicker from "../../../emoji-picker/picker"
import * as GifPicker from "../../../gif-picker/picker"

/** Channel-level keys: typing anywhere goes to the composer, ArrowUp edits your last message here. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const editorId = `composer-${channelId}`
const draft = (inner: Draft.Message) => Message.GotDraftMessage({ message: inner })
const composer = (inner: Composer.Message) => draft(Draft.Message.GotComposerMessage({ message: inner }))

describe("channel keys", () => {
	test("a key typed outside the composer is inserted into it", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedGlobalKey({ key: "h" })),
			Command.expectExact(EditorCommands.InsertEditorText({ editorId, text: "h" })),
			Command.resolve(EditorCommands.InsertEditorText, Composer.Message.CompletedInsertEditorText()),
		)
	})

	test("ArrowUp in the empty composer edits your newest message in this channel", () => {
		story(
			updateWithShared,
			given(updateWithShared(loadedModel(), loadedMessages(messages)).model),
			message(composer(Composer.Message.PressedArrowUpInEmpty())),
			Command.expectExact(
				EditorCommands.SetEditorContent({ editorId, markdown: "Shipped the onboarding copy" }),
			),
			Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
		)
	})

	test("Enter on your edit emptied of its text asks to delete the message", () => {
		const loaded = updateWithShared(loadedModel(), loadedMessages(messages)).model
		const editing = updateWithShared(loaded, composer(Composer.Message.PressedArrowUpInEmpty())).model
		story(
			updateWithShared,
			given(editing),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "" }))),
			Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			expectOutMessage(
				PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId: adaMessageId } }),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
		)
	})
})

/** Discord's channel shortcuts (`hotkeys.ts`): each does what its button does. */
describe("channel shortcuts", () => {
	test("Mod+E opens the composer's emoji picker", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "EmojiPicker" })),
			model((current) => expect(current.draft.emojiPicker.isOpen).toBe(true)),
			Command.expectExact(EmojiPicker.LoadEmojiData),
			Command.resolve(
				EmojiPicker.LoadEmojiData,
				EmojiPicker.Message.FailedLoadEmojiData({ reason: "Offline" }),
			),
		)
	})

	test("Mod+E again closes it", () => {
		const opened = updateWithShared(
			loadedModel(),
			Message.PressedChannelHotkey({ action: "EmojiPicker" }),
		)
		story(
			updateWithShared,
			given(opened.model),
			message(Message.PressedChannelHotkey({ action: "EmojiPicker" })),
			model((current) => expect(current.draft.emojiPicker.isOpen).toBe(false)),
			Command.expectNone(),
		)
	})

	test("Mod+G opens the GIF picker", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "GifPicker" })),
			model((current) => expect(current.draft.gifPicker.isOpen).toBe(true)),
			Command.expectHas(GifPicker.FetchGifs, GifPicker.FetchCategories, GifPicker.FocusGifSearch),
			Command.resolveAll(
				[
					GifPicker.FetchGifs,
					GifPicker.Message.FailedFetchGifs({ query: "", page: 1, reason: "ProviderFailed" }),
				],
				[
					GifPicker.FetchCategories,
					GifPicker.Message.FailedFetchCategories({ reason: "ProviderFailed" }),
				],
				[GifPicker.FocusGifSearch, GifPicker.Message.CompletedFocusGifSearch()],
			),
		)
	})

	test("Mod+Shift+U opens the file picker to upload", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "Upload" })),
			Command.expectExact(Draft.OpenFilePicker),
			Command.resolve(Draft.OpenFilePicker, Draft.Message.CompletedOpenFilePicker()),
		)
	})

	test("Mod+P toggles the pinned messages", () => {
		const opened = updateWithShared(loadedModel(), Message.PressedChannelHotkey({ action: "Pins" }))
		expect(opened.model.overlays.pinned.isOpen).toBe(true)
		expect(
			updateWithShared(opened.model, Message.PressedChannelHotkey({ action: "Pins" })).model.overlays
				.pinned.isOpen,
		).toBe(false)
	})
})

describe("reading keys", () => {
	test("Escape outside the composer marks the channel read", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(Message.PressedChannelHotkey({ action: "MarkRead" })),
			Command.expectExact(ClearChannelNotifications({ channelId })),
			Command.resolve(ClearChannelNotifications, Message.SucceededClearNotifications({ channelId })),
		)
	})

	test("Escape in the composer with nothing to cancel marks the channel read too", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(composer(Composer.Message.PressedEscape())),
			Command.expectExact(ClearChannelNotifications({ channelId })),
			Command.resolve(ClearChannelNotifications, Message.SucceededClearNotifications({ channelId })),
		)
	})

	test("PageUp and PageDown scroll the messages by most of a viewport", () => {
		const withViewport = (model: ReturnType<typeof loadedModel>) => ({
			...model,
			list: {
				...model.list,
				keys: Array.from({ length: 30 }, (_, index) => `row-${index}`),
				viewportHeight: 400,
				scrollTop: 1000,
				anchor: MessageList.ViewportAnchor.Row({ key: "row-12", viewportOffset: -40 }),
			},
		})
		const up = updateWithShared(
			withViewport(loadedModel()),
			Message.PressedChannelHotkey({ action: "ScrollUp" }),
		)
		expect(up.model.list.scrollTop).toBe(1000 - 336)
		const down = updateWithShared(
			withViewport(loadedModel()),
			Message.PressedChannelHotkey({ action: "ScrollDown" }),
		)
		expect(down.model.list.scrollTop).toBe(1000 + 336)
	})
})
