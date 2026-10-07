import { Effect, Queue, Schema, Stream } from "effect"
import { Command, Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { EditorEvent } from "../editor/editor-view"
import {
	closeAutocomplete,
	createComposerEditor,
	editorById,
	insertMention,
	registerEditor,
	syncAutocompleteOptionCount,
	unregisterEditor,
} from "../editor/editor-view"

/**
 * The channel composer as a Submodel: port of `SlateMessageComposer` (frame, editor,
 * actions) with mention autocomplete. The ProseMirror editor lives in a Mount; the
 * Model holds the serialized draft, the autocomplete query and the mention candidates.
 */

// MODEL

export const PresenceStatus = Schema.Literals(["online", "away", "busy", "dnd", "offline"])
export type PresenceStatus = typeof PresenceStatus.Type

export const MentionMember = Schema.Struct({
	userId: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type MentionMember = typeof MentionMember.Type

export const TriggerId = Schema.Literals(["mention", "command", "emoji"])

export const AutocompleteQuery = Schema.Struct({ trigger: TriggerId, search: Schema.String })
export type AutocompleteQuery = typeof AutocompleteQuery.Type

export const Model = Schema.Struct({
	editorId: Schema.String,
	placeholder: Schema.String,
	markdown: Schema.String,
	isEmpty: Schema.Boolean,
	autocomplete: Schema.NullOr(AutocompleteQuery),
	activeIndex: Schema.Number,
	members: Schema.Array(MentionMember),
	presence: Schema.Array(Schema.Struct({ userId: Schema.String, status: PresenceStatus })),
})
export type Model = typeof Model.Type

export const init = (editorId: string, placeholder = "Type a message..."): Model => ({
	editorId,
	placeholder,
	markdown: "",
	isEmpty: true,
	autocomplete: null,
	activeIndex: 0,
	members: [],
	presence: [],
})

// MESSAGE

export const AutocompleteKey = Schema.Literals(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"])

export const Message = defineMessageUnion({
	UpdatedDraft: { markdown: Schema.String, isEmpty: Schema.Boolean },
	ChangedAutocomplete: { autocomplete: Schema.NullOr(AutocompleteQuery) },
	PressedAutocompleteKey: { key: AutocompleteKey },
	SubmittedDraft: { markdown: Schema.String },
	PressedEscape: {},
	PressedArrowUpInEmpty: {},
	HoveredAutocompleteOption: { index: Schema.Number },
	ClickedAutocompleteOption: { index: Schema.Number },
	UpdatedMentionMembers: { members: Schema.Array(MentionMember) },
	UpdatedPresence: { presence: Schema.Array(Schema.Struct({ userId: Schema.String, status: PresenceStatus })) },
	CompletedInsertMention: {},
	CompletedSyncAutocompleteOptions: {},
	CompletedCloseAutocomplete: {},
	CompletedKeepEditorFocus: {},
})
export type Message = typeof Message.Type

/** The Messages the editor Mount streams. */
type EditorMessage =
	| typeof Message.UpdatedDraft.Type
	| typeof Message.ChangedAutocomplete.Type
	| typeof Message.PressedAutocompleteKey.Type
	| typeof Message.SubmittedDraft.Type
	| typeof Message.PressedEscape.Type
	| typeof Message.PressedArrowUpInEmpty.Type

const eventToMessage = (event: EditorEvent): EditorMessage => {
	switch (event._tag) {
		case "ChangedDoc":
			return Message.UpdatedDraft({ markdown: event.markdown, isEmpty: event.isEmpty })
		case "ChangedAutocomplete":
			return Message.ChangedAutocomplete({ autocomplete: event.autocomplete })
		case "PressedAutocompleteKey":
			return Message.PressedAutocompleteKey({ key: event.key })
		case "Submitted":
			return Message.SubmittedDraft({ markdown: event.markdown })
		case "PressedEscape":
			return Message.PressedEscape()
		case "PressedArrowUpInEmpty":
			return Message.PressedArrowUpInEmpty()
	}
}

// MOUNT

/** Owns the ProseMirror editor for the element's lifetime; editor events stream out as Messages. */
export const MountEditor = Mount.defineStream("MountEditor", {
	args: { editorId: Schema.String, placeholder: Schema.String },
	messages: [
		Message.UpdatedDraft,
		Message.ChangedAutocomplete,
		Message.PressedAutocompleteKey,
		Message.SubmittedDraft,
		Message.PressedEscape,
		Message.PressedArrowUpInEmpty,
	],
	execute: ({ element, editorId, placeholder, viewStateChanges }) =>
		Stream.callback<EditorMessage>((queue) =>
			Effect.gen(function* () {
				const view = yield* Effect.acquireRelease(
					Effect.sync(() => {
						const editor = createComposerEditor(element as HTMLElement, {
							placeholder,
							emit: (event) => Queue.offerUnsafe(queue, eventToMessage(event)),
						})
						registerEditor(editorId, editor)
						return editor
					}),
					(editor) =>
						Effect.sync(() => {
							unregisterEditor(editorId, editor)
							editor.destroy()
						}),
				)
				// Read-only while DevTools shows a historical view.
				yield* viewStateChanges.pipe(
					Stream.runForEach((viewState) => Effect.sync(() => view.setProps({ editable: () => viewState === "Live" }))),
					Effect.forkScoped,
				)
				return yield* Effect.never
			}),
		),
})

/** Legacy `EditorAutocomplete`: keep focus in the editor on press, and size to the space above. */
export const KeepEditorFocus = Mount.define("KeepEditorFocus", {
	messages: [Message.CompletedKeepEditorFocus],
	execute: ({ element }) =>
		Effect.gen(function* () {
			const popover = element as HTMLElement
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					const preventBlur = (event: Event) => event.preventDefault()
					const updateHeight = () => {
						const container = popover.parentElement?.getBoundingClientRect()
						if (container) popover.style.maxHeight = `${Math.min(Math.max(container.top - 16, 150), 400)}px`
					}
					updateHeight()
					popover.addEventListener("mousedown", preventBlur)
					window.addEventListener("resize", updateHeight)
					window.addEventListener("scroll", updateHeight, { passive: true })
					return { preventBlur, updateHeight }
				}),
				({ preventBlur, updateHeight }) =>
					Effect.sync(() => {
						popover.removeEventListener("mousedown", preventBlur)
						window.removeEventListener("resize", updateHeight)
						window.removeEventListener("scroll", updateHeight)
					}),
			)
			return Message.CompletedKeepEditorFocus()
		}),
})

// COMMAND

const withEditor = (editorId: string, f: (view: NonNullable<ReturnType<typeof editorById>>) => void) =>
	Effect.sync(() => {
		const view = editorById(editorId)
		if (view) f(view)
	})

export const InsertMention = Command.define("InsertMention", {
	args: { editorId: Schema.String, userId: Schema.String, displayName: Schema.String },
	messages: [Message.CompletedInsertMention],
	execute: ({ editorId, userId, displayName }) =>
		withEditor(editorId, (view) => insertMention(view, userId, displayName)).pipe(
			Effect.as(Message.CompletedInsertMention()),
		),
})

export const SyncAutocompleteOptions = Command.define("SyncAutocompleteOptions", {
	args: { editorId: Schema.String, optionCount: Schema.Number },
	messages: [Message.CompletedSyncAutocompleteOptions],
	execute: ({ editorId, optionCount }) =>
		withEditor(editorId, (view) => syncAutocompleteOptionCount(view, optionCount)).pipe(
			Effect.as(Message.CompletedSyncAutocompleteOptions()),
		),
})

export const CloseAutocomplete = Command.define("CloseAutocomplete", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedCloseAutocomplete],
	execute: ({ editorId }) =>
		withEditor(editorId, closeAutocomplete).pipe(Effect.as(Message.CompletedCloseAutocomplete())),
})
