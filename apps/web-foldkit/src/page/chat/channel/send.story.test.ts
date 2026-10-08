import { AttachmentId, TypingIndicatorId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as EditorCommands from "../../../composer/editor-commands"
import * as Typing from "../../../composer/typing"
import { UploadEvent } from "../../../composer/upload"
import { PageOutMessage } from "../../out-message"
import * as Overlays from "../overlays"
import {
	ada,
	adaMemberId,
	adaMessageId,
	channelId,
	graceMessageId,
	loadedModel,
	updateWithShared,
} from "./fixtures.test-support"
import { Message } from "./model"

/** Behavioral parity of the composer: each interaction issues the legacy action with the legacy payload. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const draft = (inner: Draft.Message) => Message.GotDraftMessage({ message: inner })
const composer = (inner: Composer.Message) => draft(Draft.Message.GotComposerMessage({ message: inner }))
const overlays = (inner: Overlays.Message) => Message.GotOverlaysMessage({ message: inner })
const editorId = `composer-${channelId}`

describe("send", () => {
	test("Enter sends `message.create` through sendMessageAction and clears the editor", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "Hello **team**" }))),
			Command.expectHas(
				Draft.SendMessage({
					channelId,
					authorId: ada,
					content: "Hello **team**",
					replyToMessageId: null,
					threadChannelId: null,
					attachmentIds: [],
					restoreContent: true,
				}),
				EditorCommands.ClearEditor({ editorId }),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(Draft.SendMessage, Draft.Message.SucceededSendMessage()),
			Command.resolveAll(),
		)
	})

	test("an empty draft without attachments sends nothing", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "" }))),
			Command.expectNone(),
		)
	})

	test("a reply sends replyToMessageId and clears the reply", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedReply({ messageId: graceMessageId }))),
			model((current) => expect(current.draft.replyToMessageId).toBe(graceMessageId)),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "On it" }))),
			model((current) => expect(current.draft.replyToMessageId).toBeNull()),
			Command.expectHas(
				Draft.SendMessage({
					channelId,
					authorId: ada,
					content: "On it",
					replyToMessageId: graceMessageId,
					threadChannelId: null,
					attachmentIds: [],
					restoreContent: true,
				}),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(Draft.SendMessage, Draft.Message.SucceededSendMessage()),
			Command.resolveAll(),
		)
	})

	test("a failed send restores the content, the reply and the attachments, then toasts", () => {
		const toast = { intent: "error" as const, title: "Channel not found", description: "This channel may have been deleted." }
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedReply({ messageId: graceMessageId }))),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "On it" }))),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(
				Draft.SendMessage,
				Draft.Message.FailedSendMessage({
					content: "On it",
					restoreContent: true,
					replyToMessageId: graceMessageId,
					attachmentIds: [],
					toast,
				}),
			),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			model((current) => expect(current.draft.replyToMessageId).toBe(graceMessageId)),
			Command.expectHas(EditorCommands.SetEditorContent({ editorId, markdown: "On it" })),
			Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
		)
	})

	test("a GIF is sent as its URL, without touching the editor", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(draft(Draft.Message.SelectedGif({ url: "https://media.klipy.com/cat.gif" }))),
			Command.expectExact(
				Draft.SendMessage({
					channelId,
					authorId: ada,
					content: "https://media.klipy.com/cat.gif",
					replyToMessageId: null,
					threadChannelId: null,
					attachmentIds: [],
					restoreContent: false,
				}),
			),
			Command.resolve(Draft.SendMessage, Draft.Message.SucceededSendMessage()),
			Command.resolveAll(),
		)
	})
})

describe("edit", () => {
	test("Arrow Up in an empty composer loads the last own message; Enter sends `message.update`", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(composer(Composer.Message.PressedArrowUpInEmpty())),
			model((current) => expect(current.draft.editingMessageId).toBe(adaMessageId)),
			Command.expectExact(EditorCommands.SetEditorContent({ editorId, markdown: "Shipped the onboarding copy" })),
			Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "Shipped the new onboarding copy" }))),
			model((current) => expect(current.draft.editingMessageId).toBeNull()),
			Command.expectExact(
				EditorCommands.ClearEditor({ editorId }),
				Draft.EditMessage({ messageId: adaMessageId, content: "Shipped the new onboarding copy" }),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(Draft.EditMessage, Draft.Message.CompletedEditMessage({ toast: null })),
		)
	})

	test("the toolbar's Edit starts editing; Escape cancels and clears", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(overlays(Overlays.Message.ClickedEdit({ messageId: adaMessageId }))),
			Command.resolve(EditorCommands.SetEditorContent, Composer.Message.CompletedSetEditorContent()),
			message(composer(Composer.Message.PressedEscape())),
			model((current) => expect(current.draft.editingMessageId).toBeNull()),
			Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
		)
	})
})

describe("typing", () => {
	const indicatorId = Schema.decodeSync(TypingIndicatorId)("00000000-0000-4000-8000-000000009999")

	test("typing sends `typingIndicator.create` with the membership; emptying deletes it", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(composer(Composer.Message.UpdatedDraft({ markdown: "H", isEmpty: false }))),
			Command.expectHas(Typing.SendTypingHeartbeat({ channelId, memberId: adaMemberId, sessionId: 1 })),
			Command.resolve(
				Typing.SendTypingHeartbeat,
				Typing.Message.SucceededSendTypingHeartbeat({ sessionId: 1, indicatorId }),
			),
			message(composer(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true }))),
			Command.expectHas(Typing.DeleteTypingIndicator({ id: indicatorId })),
			Command.resolve(Typing.DeleteTypingIndicator, Typing.Message.CompletedDeleteTypingIndicator()),
			Command.resolve(
				Typing.WaitForHeartbeatInterval,
				Typing.Message.CompletedWaitForHeartbeatInterval({ version: 1 }),
			),
			Command.resolve(Typing.WaitForTypingTimeout, Typing.Message.CompletedWaitForTypingTimeout({ version: 1 })),
		)
	})
})

describe("uploads", () => {
	const attachmentId = Schema.decodeSync(AttachmentId)("00000000-0000-4000-8000-000000007777")
	const file = new File(["png"], "diagram.png", { type: "image/png" })

	test("a selected file uploads with progress, then sends as an attachment", () => {
		story(
			updateWithShared,
			given(loadedModel()),
			message(draft(Draft.Message.SelectedFiles({ files: [file] }))),
			Command.resolve(Draft.GenerateUploadFileId, Draft.Message.CompletedGenerateUploadFileId({ fileId: "f1" })),
			model((current) => expect(current.draft.uploadingFiles).toEqual([{ fileId: "f1", fileName: "diagram.png", fileSize: 3, progress: 0 }])),
			message(draft(Draft.Message.GotUploadEvent({ event: UploadEvent.ProgressedUpload({ fileId: "f1", progress: 40 }) }))),
			model((current) => expect(current.draft.uploadingFiles[0]?.progress).toBe(40)),
			message(
				draft(
					Draft.Message.GotUploadEvent({
						event: UploadEvent.FinishedUpload({ fileId: "f1", attachmentId, toast: null }),
					}),
				),
			),
			model((current) => {
				expect(current.draft.uploadingFiles).toEqual([])
				expect(current.draft.attachmentIds).toEqual([attachmentId])
			}),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "" }))),
			Command.expectHas(
				Draft.SendMessage({
					channelId,
					authorId: ada,
					content: "",
					replyToMessageId: null,
					threadChannelId: null,
					attachmentIds: [attachmentId],
					restoreContent: true,
				}),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(Draft.SendMessage, Draft.Message.SucceededSendMessage()),
			Command.resolveAll(),
		)
	})
})
