import { AttachmentId, ChannelId, ChannelMemberId, MessageId, OrganizationId, TypingIndicatorId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "./composer"
import * as Draft from "./draft"
import * as DraftUpdate from "./draft-update"
import { DropEvent } from "./drop"
import * as EditorCommands from "./editor-commands"
import * as Typing from "./typing"
import { UploadEvent } from "./upload"
import type { ToastRequest } from "../overlay/toasts"

/** One draft's update (reply, edit, uploads, slash commands, typing), outside any page. */

// ProseMirror's view reads `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const ada = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(4))
const memberId = Schema.decodeSync(ChannelMemberId)(uuid(5))
const replyId = Schema.decodeSync(MessageId)(uuid(1001))
const editId = Schema.decodeSync(MessageId)(uuid(1002))
const firstAttachment = Schema.decodeSync(AttachmentId)(uuid(7001))
const secondAttachment = Schema.decodeSync(AttachmentId)(uuid(7002))
const indicatorId = Schema.decodeSync(TypingIndicatorId)(uuid(9001))
const editorId = "composer-draft"

const context: Draft.Context = { currentUserId: ada, organizationId, memberId, lastOwnMessage: null }
const signedOut: Draft.Context = { ...context, currentUserId: null }

const update = (current: Draft.Model, next: Draft.Message) => DraftUpdate.update(current, next, context)
const updateSignedOut = (current: Draft.Model, next: Draft.Message) => DraftUpdate.update(current, next, signedOut)

const fresh = () => Draft.init(channelId, editorId)
const { Message } = Draft
const composer = (inner: Composer.Message) => Message.GotComposerMessage({ message: inner })
const pngA = new File(["a"], "a.png", { type: "image/png" })
const pngB = new File(["bb"], "b.png", { type: "image/png" })

describe("reply and edit", () => {
	test("Cancel on the reply indicator drops the reply", () => {
		story(
			update,
			given({ ...fresh(), replyToMessageId: replyId }),
			message(Message.ClickedCancelReply()),
			Command.expectNone(),
			model((current) => expect(current.replyToMessageId).toBeNull()),
		)
	})

	test("replying while editing leaves edit mode (one indicator at a time)", () => {
		const replying = DraftUpdate.setReply({ ...fresh(), editingMessageId: editId }, replyId)
		expect(replying.editingMessageId).toBeNull()
		expect(replying.replyToMessageId).toBe(replyId)
	})

	test("Cancel on the edit indicator leaves edit mode and clears the editor", () => {
		story(
			update,
			given({ ...fresh(), editingMessageId: editId }),
			message(Message.ClickedCancelEdit()),
			Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			model((current) => expect(current.editingMessageId).toBeNull()),
		)
	})

	test("an empty edit is not sent and keeps edit mode", () => {
		story(
			update,
			given({ ...fresh(), editingMessageId: editId }),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "   " }))),
			Command.expectNone(),
			model((current) => expect(current.editingMessageId).toBe(editId)),
		)
	})

	test("a failed edit raises its toast", () => {
		const toast: ToastRequest = { intent: "error", title: "Message not found", description: null }
		story(
			update,
			given(fresh()),
			message(Message.CompletedEditMessage({ toast })),
			expectOutMessage(Draft.OutMessage.RequestedToast({ toast })),
		)
	})
})

describe("attachments", () => {
	test("files upload one after another; each finished upload becomes an attachment", () => {
		story(
			update,
			given(fresh()),
			message(Message.SelectedFiles({ files: [pngA, pngB] })),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(Draft.GenerateUploadFileId, Message.CompletedGenerateUploadFileId({ fileId: "f1" })),
			model((current) => {
				expect(current.currentUpload?.fileId).toBe("f1")
				expect(current.pendingFiles).toHaveLength(1)
				expect(Draft.isUploading(current)).toBe(true)
			}),
			message(
				Message.GotUploadEvent({
					event: UploadEvent.FinishedUpload({ fileId: "f1", attachmentId: firstAttachment, toast: null }),
				}),
			),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(Draft.GenerateUploadFileId, Message.CompletedGenerateUploadFileId({ fileId: "f2" })),
			message(
				Message.GotUploadEvent({
					event: UploadEvent.FinishedUpload({ fileId: "f2", attachmentId: secondAttachment, toast: null }),
				}),
			),
			Command.expectNone(),
			model((current) => {
				expect(current.attachmentIds).toEqual([firstAttachment, secondAttachment])
				expect(current.uploadingFiles).toEqual([])
				expect(Draft.isUploading(current)).toBe(false)
			}),
		)
	})

	test("a failed upload toasts and adds no attachment", () => {
		const toast: ToastRequest = { intent: "error", title: "Upload failed", description: null }
		story(
			update,
			given({
				...fresh(),
				currentUpload: { fileId: "f1", file: pngA },
				uploadingFiles: [{ fileId: "f1", fileName: "a.png", fileSize: 1, progress: 30 }],
			}),
			message(Message.GotUploadEvent({ event: UploadEvent.FinishedUpload({ fileId: "f1", attachmentId: null, toast }) })),
			expectOutMessage(Draft.OutMessage.RequestedToast({ toast })),
			model((current) => {
				expect(current.attachmentIds).toEqual([])
				expect(current.uploadingFiles).toEqual([])
			}),
		)
	})

	test("while a file uploads, Enter and the Attach button do nothing", () => {
		story(
			update,
			given({ ...fresh(), currentUpload: { fileId: "f1", file: pngA } }),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "caption" }))),
			Command.expectNone(),
			message(Message.ClickedAttach()),
			Command.expectNone(),
		)
	})

	test("Attach opens the hidden file input", () => {
		story(
			update,
			given(fresh()),
			message(Message.ClickedAttach()),
			Command.expectExact(Draft.OpenFilePicker({ inputId: `${editorId}-file-input` })),
			Command.resolve(Draft.OpenFilePicker, Message.CompletedOpenFilePicker()),
		)
	})

	test("dropped files queue like selected ones; the drag state follows the pointer", () => {
		story(
			update,
			given(fresh()),
			message(Message.GotDropEvent({ event: DropEvent.ChangedDragState({ isDraggingOnPage: true, isDropTarget: true }) })),
			model((current) => expect(current.isDropTarget).toBe(true)),
			message(Message.GotDropEvent({ event: DropEvent.DroppedFiles({ files: [pngA] }) })),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(Draft.GenerateUploadFileId, Message.CompletedGenerateUploadFileId({ fileId: "f1" })),
		)
	})

	test("removing an attachment drops only that id", () => {
		story(
			update,
			given({ ...fresh(), attachmentIds: [firstAttachment, secondAttachment] }),
			message(Message.ClickedRemoveAttachment({ attachmentId: firstAttachment })),
			model((current) => expect(current.attachmentIds).toEqual([secondAttachment])),
		)
	})

	test("signed out, selecting files toasts instead of uploading", () => {
		story(
			updateSignedOut,
			given(fresh()),
			message(Message.SelectedFiles({ files: [pngA] })),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Authentication required",
						description: "You must be logged in to upload files",
					},
				}),
			),
		)
	})
})

describe("typing indicator", () => {
	test("leaving the window deletes the live indicator", () => {
		story(
			update,
			given({ ...fresh(), typing: { ...Typing.init(), isTyping: true, sessionId: 1, indicatorId, lastContent: "H" } }),
			message(Message.LeftWindow()),
			Command.expectExact(Typing.DeleteTypingIndicator({ id: indicatorId })),
			Command.resolve(
				Typing.DeleteTypingIndicator,
				Typing.Message.CompletedDeleteTypingIndicator(),
			),
			model((current) => expect(current.typing.isTyping).toBe(false)),
		)
	})

	test("a heartbeat that answers after the session ended deletes its indicator", () => {
		story(
			update,
			given({ ...fresh(), typing: { ...Typing.init(), isTyping: false, sessionId: 2 } }),
			message(
				Message.GotTypingMessage({
					message: Typing.Message.SucceededSendTypingHeartbeat({ sessionId: 1, indicatorId }),
				}),
			),
			Command.expectExact(Typing.DeleteTypingIndicator({ id: indicatorId })),
			Command.resolve(
				Typing.DeleteTypingIndicator,
				Typing.Message.CompletedDeleteTypingIndicator(),
			),
		)
	})

	test("without a channel membership typing sends nothing", () => {
		story(
			(current: Draft.Model, next: Draft.Message) => DraftUpdate.update(current, next, { ...context, memberId: null }),
			given(fresh()),
			message(composer(Composer.Message.UpdatedDraft({ markdown: "H", isEmpty: false }))),
			Command.expectNone(),
		)
	})
})

describe("slash command execution", () => {
	const command: Composer.BotCommand = {
		id: "command-deploy",
		name: "deploy",
		description: "Deploy",
		bot: { id: "bot-ci", name: "CI", avatarUrl: null },
		arguments: [{ name: "branch", description: null, required: true, placeholder: null, type: "string" }],
	}
	const inCommand = (values: Record<string, string>): Draft.Model => {
		const base = fresh()
		return { ...base, composer: { ...base.composer, commandInput: { command, values, focusedFieldIndex: 0 } } }
	}

	test("a missing required argument toasts and runs nothing", () => {
		story(
			update,
			given(inCommand({})),
			message(composer(Composer.Message.ClickedExecuteCommand())),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({ toast: { intent: "error", title: "Missing required: branch", description: null } }),
			),
		)
	})

	test("Enter in a field executes; success leaves command mode and focuses the editor", () => {
		const toast: ToastRequest = { intent: "success", title: "Executed /deploy", description: null }
		story(
			update,
			given(inCommand({ branch: "main" })),
			message(composer(Composer.Message.PressedCommandFieldKey({ index: 0, key: "Enter", shiftKey: false }))),
			Command.expectExact(
				Draft.ExecuteBotCommand({
					orgId: organizationId,
					botId: "bot-ci",
					commandName: "deploy",
					botName: "CI",
					channelId,
					arguments: [{ name: "branch", value: "main" }],
				}),
			),
			Command.resolve(Draft.ExecuteBotCommand, Message.CompletedExecuteBotCommand({ succeeded: true, toast })),
			expectOutMessage(Draft.OutMessage.RequestedToast({ toast })),
			Command.expectExact(EditorCommands.FocusEditor({ editorId })),
			Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
			model((current) => expect(current.composer.commandInput).toBeNull()),
		)
	})

	test("a failed command keeps the argument panel open", () => {
		const toast: ToastRequest = { intent: "error", title: "Command failed", description: null }
		story(
			update,
			given(inCommand({ branch: "main" })),
			message(Message.CompletedExecuteBotCommand({ succeeded: false, toast })),
			expectOutMessage(Draft.OutMessage.RequestedToast({ toast })),
			model((current) => expect(current.composer.commandInput?.command.name).toBe("deploy")),
		)
	})
})

describe("emoji", () => {
	test("a unicode emoji is typed into the editor; a custom one is inserted inline", () => {
		story(
			update,
			given(fresh()),
			message(Message.SelectedEmoji({ emoji: "🎉", label: "party", imageUrl: null })),
			Command.expectExact(EditorCommands.InsertEditorText({ editorId, text: "🎉" })),
			Command.resolve(EditorCommands.InsertEditorText, Composer.Message.CompletedInsertEditorText()),
			message(Message.SelectedEmoji({ emoji: ":hazel:", label: "hazel", imageUrl: "https://cdn/hazel.png" })),
			Command.expectExact(
				EditorCommands.InsertCustomEmoji({ editorId, name: "hazel", imageUrl: "https://cdn/hazel.png" }),
			),
			Command.resolve(EditorCommands.InsertCustomEmoji, Composer.Message.CompletedInsertCustomEmoji()),
		)
	})
})
