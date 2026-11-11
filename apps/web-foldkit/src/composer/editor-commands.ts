import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import * as Render from "foldkit/render"
import {
	clearContent,
	focusAndInsertText,
	focusAndPasteText,
	focusAtEnd,
	insertCustomEmoji,
	insertEmojiResult,
	removeTriggerText,
	setContent,
} from "../editor/operations"
import { withEditor } from "../editor/registry"
import { ComposerEmoji, Message, onEditor } from "./composer"

/**
 * Commands that act on a live composer editor (the legacy `SlateMessageEditorRef` calls). The update
 * that returns one already wrote the result into the Model where it matters (`markdown`), so a
 * `Failed*` for an unmounted editor loses nothing: the next mount starts from the Model.
 */

/** `setContent` plus `focus` (editing a message, restoring a failed send). */
export const SetEditorContent = Command.define("SetEditorContent", {
	args: { editorId: Schema.String, markdown: Schema.String },
	messages: [Message.CompletedSetEditorContent, Message.FailedSetEditorContent],
	execute: ({ editorId, markdown }) =>
		onEditor(
			editorId,
			(view) => {
				setContent(view, markdown)
				focusAtEnd(view)
			},
			Message.CompletedSetEditorContent(),
			Message.FailedSetEditorContent,
		),
})

/** `clearContent` (legacy `resetAndFocus`). */
export const ClearEditor = Command.define("ClearEditor", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedClearEditor, Message.FailedClearEditor],
	execute: ({ editorId }) =>
		onEditor(editorId, clearContent, Message.CompletedClearEditor(), Message.FailedClearEditor),
})

export const FocusEditor = Command.define("FocusEditor", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedFocusEditor],
	execute: ({ editorId }) =>
		withEditor(editorId, focusAtEnd).pipe(
			// Best-effort: an unmounted editor has nothing to focus.
			Effect.ignore,
			Effect.as(Message.CompletedFocusEditor()),
		),
})

/** `focusAndInsertText`: the emoji picker and the global typing redirect. */
export const InsertEditorText = Command.define("InsertEditorText", {
	args: { editorId: Schema.String, text: Schema.String },
	messages: [Message.CompletedInsertEditorText, Message.FailedInsertEditorText],
	execute: ({ editorId, text }) =>
		// Legacy inserts once a closing picker has left the DOM.
		Render.afterCommit.pipe(
			Effect.andThen(
				onEditor(
					editorId,
					(view) => focusAndInsertText(view, text),
					Message.CompletedInsertEditorText(),
					Message.FailedInsertEditorText,
				),
			),
		),
})

/** Text pasted outside the editor (the global paste redirect), pasted as it would be inside. */
export const PasteEditorText = Command.define("PasteEditorText", {
	args: { editorId: Schema.String, text: Schema.String },
	messages: [Message.CompletedInsertEditorText, Message.FailedInsertEditorText],
	execute: ({ editorId, text }) =>
		onEditor(
			editorId,
			(view) => focusAndPasteText(view, text),
			Message.CompletedInsertEditorText(),
			Message.FailedInsertEditorText,
		),
})

export const InsertCustomEmoji = Command.define("InsertCustomEmoji", {
	args: { editorId: Schema.String, name: Schema.String, imageUrl: Schema.String },
	messages: [Message.CompletedInsertCustomEmoji, Message.FailedInsertCustomEmoji],
	execute: ({ editorId, name, imageUrl }) =>
		Render.afterCommit.pipe(
			Effect.andThen(
				onEditor(
					editorId,
					(view) => insertCustomEmoji(view, name, imageUrl),
					Message.CompletedInsertCustomEmoji(),
					Message.FailedInsertCustomEmoji,
				),
			),
		),
})

export const InsertEmoji = Command.define("InsertEmoji", {
	args: { editorId: Schema.String, emoji: Schema.String, custom: Schema.NullOr(ComposerEmoji) },
	messages: [Message.CompletedInsertEmoji, Message.FailedInsertEmoji],
	execute: ({ editorId, emoji, custom }) =>
		onEditor(
			editorId,
			(view) => insertEmojiResult(view, emoji, custom),
			Message.CompletedInsertEmoji(),
			Message.FailedInsertEmoji,
		),
})

/** Entering command input mode deletes the `/query` text. */
export const RemoveTriggerText = Command.define("RemoveTriggerText", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedRemoveTriggerText, Message.FailedRemoveTriggerText],
	execute: ({ editorId }) =>
		onEditor(
			editorId,
			removeTriggerText,
			Message.CompletedRemoveTriggerText(),
			Message.FailedRemoveTriggerText,
		),
})

export const commandFieldId = (editorId: string, index: number) => `${editorId}-command-field-${index}`

/** `CommandInputPanel` focuses a field when the panel opens and on Tab. */
export const FocusCommandField = Command.define("FocusCommandField", {
	args: { editorId: Schema.String, index: Schema.Number },
	messages: [Message.CompletedFocusCommandField],
	execute: ({ editorId, index }) =>
		Dom.focus(`#${CSS.escape(commandFieldId(editorId, index))}`).pipe(
			// Best-effort: a command without arguments has no field to focus.
			Effect.ignore,
			Effect.as(Message.CompletedFocusCommandField()),
		),
})
