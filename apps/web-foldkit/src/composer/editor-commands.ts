import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import {
	clearContent,
	focusAndInsertText,
	focusAtEnd,
	insertCustomEmoji,
	insertEmojiResult,
	removeTriggerText,
	setContent,
} from "../editor/operations"
import { ComposerEmoji, Message, withEditor } from "./composer"

/** Commands that act on a live composer editor (the legacy `SlateMessageEditorRef` calls). */

/** `setContent` plus `focus` (editing a message, restoring a failed send). */
export const SetEditorContent = Command.define("SetEditorContent", {
	args: { editorId: Schema.String, markdown: Schema.String },
	messages: [Message.CompletedSetEditorContent],
	execute: ({ editorId, markdown }) =>
		withEditor(editorId, (view) => {
			setContent(view, markdown)
			focusAtEnd(view)
		}).pipe(Effect.as(Message.CompletedSetEditorContent())),
})

/** `clearContent` (legacy `resetAndFocus`). */
export const ClearEditor = Command.define("ClearEditor", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedClearEditor],
	execute: ({ editorId }) => withEditor(editorId, clearContent).pipe(Effect.as(Message.CompletedClearEditor())),
})

export const FocusEditor = Command.define("FocusEditor", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedFocusEditor],
	execute: ({ editorId }) => withEditor(editorId, focusAtEnd).pipe(Effect.as(Message.CompletedFocusEditor())),
})

/** `focusAndInsertText`: the emoji picker and the global typing redirect. */
export const InsertEditorText = Command.define("InsertEditorText", {
	args: { editorId: Schema.String, text: Schema.String },
	messages: [Message.CompletedInsertEditorText],
	execute: ({ editorId, text }) =>
		withEditor(editorId, (view) => focusAndInsertText(view, text)).pipe(
			Effect.as(Message.CompletedInsertEditorText()),
		),
})

export const InsertCustomEmoji = Command.define("InsertCustomEmoji", {
	args: { editorId: Schema.String, name: Schema.String, imageUrl: Schema.String },
	messages: [Message.CompletedInsertCustomEmoji],
	execute: ({ editorId, name, imageUrl }) =>
		withEditor(editorId, (view) => insertCustomEmoji(view, name, imageUrl)).pipe(
			Effect.as(Message.CompletedInsertCustomEmoji()),
		),
})

export const InsertEmoji = Command.define("InsertEmoji", {
	args: { editorId: Schema.String, emoji: Schema.String, custom: Schema.NullOr(ComposerEmoji) },
	messages: [Message.CompletedInsertEmoji],
	execute: ({ editorId, emoji, custom }) =>
		withEditor(editorId, (view) => insertEmojiResult(view, emoji, custom)).pipe(
			Effect.as(Message.CompletedInsertEmoji()),
		),
})

/** Entering command input mode deletes the `/query` text. */
export const RemoveTriggerText = Command.define("RemoveTriggerText", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedRemoveTriggerText],
	execute: ({ editorId }) =>
		withEditor(editorId, removeTriggerText).pipe(Effect.as(Message.CompletedRemoveTriggerText())),
})

export const commandFieldId = (editorId: string, index: number) => `${editorId}-command-field-${index}`

/** `CommandInputPanel` focuses the field at `focusedFieldIndex`. */
export const FocusCommandField = Command.define("FocusCommandField", {
	args: { editorId: Schema.String, index: Schema.Number },
	messages: [Message.CompletedFocusCommandField],
	execute: ({ editorId, index }) =>
		Effect.sync(() => document.getElementById(commandFieldId(editorId, index))?.focus()).pipe(
			Effect.as(Message.CompletedFocusCommandField()),
		),
})
