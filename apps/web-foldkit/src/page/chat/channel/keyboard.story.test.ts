import { Command, given, message, story } from "foldkit/story"
import { describe, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import { channelId, loadedMessages, loadedModel, messages, updateWithShared } from "./fixtures.test-support"
import { Message } from "./model"

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
})
