import { BotCommandId, BotId, UserId } from "@hazel/schema"
import { Effect, Match, Queue, Schema, Stream } from "effect"
import { Command, File, Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { EditorView } from "prosemirror-view"
import { CommonReason } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import type { EditorEvent } from "../editor/editor-view"
import {
	closeAutocomplete,
	createComposerEditor,
	insertMention,
	syncAutocompleteOptions,
} from "../editor/editor-view"
import { editorRegistry, withEditor } from "../editor/registry"

/**
 * The channel composer as a Submodel: port of `SlateMessageComposer` (frame, editor,
 * actions) with mention autocomplete. The ProseMirror editor lives in a Mount; the
 * Model owns the draft's markdown (a remounted editor starts from it), the autocomplete
 * query and the mention candidates.
 */

// MODEL

export const PresenceStatus = Schema.Literals(["online", "away", "busy", "dnd", "offline"])
export type PresenceStatus = typeof PresenceStatus.Type

export const MentionMember = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type MentionMember = typeof MentionMember.Type

export const MentionableBot = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
})
export type MentionableBot = typeof MentionableBot.Type

export const Presence = Schema.Struct({ userId: UserId, status: PresenceStatus })
export type Presence = typeof Presence.Type

/** Legacy `BotCommandData` (provider is always "bot"). */
export const BotCommand = Schema.Struct({
	id: BotCommandId,
	name: Schema.String,
	description: Schema.String,
	bot: Schema.Struct({ id: BotId, name: Schema.String, avatarUrl: Schema.NullOr(Schema.String) }),
	arguments: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			description: Schema.NullOr(Schema.String),
			required: Schema.Boolean,
			placeholder: Schema.NullOr(Schema.String),
			type: Schema.String,
		}),
	),
})
export type BotCommand = typeof BotCommand.Type

export const ComposerEmoji = Schema.Struct({ name: Schema.String, imageUrl: Schema.String })
export type ComposerEmoji = typeof ComposerEmoji.Type

/** Whether the command's Execute is in flight (a second press waits for the first). */
export const CommandSubmission = Schema.Literals(["Idle", "Executing"])
export type CommandSubmission = typeof CommandSubmission.Type

/** Legacy `CommandInputState` while a slash command collects its arguments. */
export const CommandInput = Schema.Struct({
	command: BotCommand,
	values: Schema.Record(Schema.String, Schema.String),
	submission: CommandSubmission,
})
export type CommandInput = typeof CommandInput.Type

export const TriggerId = Schema.Literals(["mention", "command", "emoji"])

export const AutocompleteQuery = Schema.Struct({ trigger: TriggerId, search: Schema.String })
export type AutocompleteQuery = typeof AutocompleteQuery.Type

export const Model = Schema.Struct({
	editorId: Schema.String,
	placeholder: Schema.String,
	/** The draft text. The editor reports every change; a remounted editor starts from it. */
	markdown: Schema.String,
	autocomplete: Schema.NullOr(AutocompleteQuery),
	activeIndex: Schema.Number,
	members: Schema.Array(MentionMember),
	presence: Schema.Array(Presence),
	mentionableBots: Schema.Array(MentionableBot),
	botCommands: Schema.Array(BotCommand),
	customEmojis: Schema.Array(ComposerEmoji),
	commandInput: Schema.NullOr(CommandInput),
})
export type Model = typeof Model.Type

export const init = (editorId: string, placeholder = "Type a message..."): Model => ({
	editorId,
	placeholder,
	markdown: "",
	autocomplete: null,
	activeIndex: 0,
	members: [],
	presence: [],
	mentionableBots: [],
	botCommands: [],
	customEmojis: [],
	commandInput: null,
})

/** The autocomplete listbox's DOM id (the editor's `aria-controls`). */
export const listboxId = (editorId: string) => `${editorId}-autocomplete`

/** An autocomplete option's DOM id (the editor's `aria-activedescendant`). */
export const optionDomId = (editorId: string, index: number) => `${editorId}-option-${index}`

/** Why a Command could not act on the editor: its element is not in the DOM, or something broke. */
export const EditorFailure = Schema.Union([Schema.Literal("EditorNotMounted"), CommonReason])
export type EditorFailure = typeof EditorFailure.Type

// MESSAGE

export const AutocompleteKey = Schema.Literals(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"])

const failedOnEditor = { reason: EditorFailure }

export const Message = defineMessageUnion({
	UpdatedDraft: { markdown: Schema.String, isEmpty: Schema.Boolean },
	ChangedAutocomplete: { autocomplete: Schema.NullOr(AutocompleteQuery) },
	PressedAutocompleteKey: { key: AutocompleteKey },
	SubmittedDraft: { markdown: Schema.String },
	PressedEscape: {},
	PressedArrowUpInEmpty: {},
	/** Shift+Tab in the editor: the page moves the focus to its messages. */
	PressedShiftTab: {},
	PastedFiles: { files: Schema.Array(File.File) },
	HoveredAutocompleteOption: { index: Schema.Number },
	ClickedAutocompleteOption: { index: Schema.Number },
	UpdatedMentionMembers: { members: Schema.Array(MentionMember) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedMentionableBots: { bots: Schema.Array(MentionableBot) },
	UpdatedBotCommands: { commands: Schema.Array(BotCommand) },
	UpdatedCustomEmojis: { emojis: Schema.Array(ComposerEmoji) },
	UpdatedCommandValue: { argName: Schema.String, value: Schema.String },
	PressedCommandFieldKey: { index: Schema.Number, key: Schema.String, shiftKey: Schema.Boolean },
	ClickedExecuteCommand: {},
	ClickedCancelCommand: {},
	CompletedPreventEditorBlur: {},
	CompletedFitAutocompleteHeight: {},
	CompletedInsertMention: {},
	FailedInsertMention: failedOnEditor,
	CompletedSyncAutocompleteOptions: {},
	FailedSyncAutocompleteOptions: failedOnEditor,
	CompletedCloseAutocomplete: {},
	FailedCloseAutocomplete: failedOnEditor,
	CompletedSetEditorContent: {},
	FailedSetEditorContent: failedOnEditor,
	CompletedClearEditor: {},
	FailedClearEditor: failedOnEditor,
	CompletedFocusEditor: {},
	CompletedInsertEditorText: {},
	FailedInsertEditorText: failedOnEditor,
	CompletedInsertCustomEmoji: {},
	FailedInsertCustomEmoji: failedOnEditor,
	CompletedInsertEmoji: {},
	FailedInsertEmoji: failedOnEditor,
	CompletedRemoveTriggerText: {},
	FailedRemoveTriggerText: failedOnEditor,
	CompletedFocusCommandField: {},
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
	| typeof Message.PressedShiftTab.Type
	| typeof Message.PastedFiles.Type

const eventToMessage = (event: EditorEvent): EditorMessage =>
	Match.value(event).pipe(
		Match.tagsExhaustive({
			ChangedDoc: ({ markdown, isEmpty }) => Message.UpdatedDraft({ markdown, isEmpty }),
			ChangedAutocomplete: ({ autocomplete }) => Message.ChangedAutocomplete({ autocomplete }),
			PressedAutocompleteKey: ({ key }) => Message.PressedAutocompleteKey({ key }),
			Submitted: ({ markdown }) => Message.SubmittedDraft({ markdown }),
			PressedEscape: () => Message.PressedEscape(),
			PressedArrowUpInEmpty: () => Message.PressedArrowUpInEmpty(),
			PressedShiftTab: () => Message.PressedShiftTab(),
			PastedFiles: ({ files }) => Message.PastedFiles({ files }),
		}),
	)

// MOUNT

/**
 * Owns the ProseMirror editor for the element's lifetime; editor events stream out as Messages.
 * `initialMarkdown` is read once, when the element mounts: the Model's draft after a remount.
 */
export const MountEditor = Mount.defineStream("MountEditor", {
	args: { editorId: Schema.String, placeholder: Schema.String, initialMarkdown: Schema.String },
	messages: [
		Message.UpdatedDraft,
		Message.ChangedAutocomplete,
		Message.PressedAutocompleteKey,
		Message.SubmittedDraft,
		Message.PressedEscape,
		Message.PressedArrowUpInEmpty,
		Message.PressedShiftTab,
		Message.PastedFiles,
	],
	execute: ({ element, editorId, placeholder, initialMarkdown, viewStateChanges }) =>
		Stream.callback<EditorMessage>((queue) =>
			Effect.gen(function* () {
				const view = yield* Effect.acquireRelease(
					Effect.sync(() =>
						createComposerEditor(element as HTMLElement, {
							placeholder,
							initialMarkdown,
							listboxId: listboxId(editorId),
							emit: (event) => Queue.offerUnsafe(queue, eventToMessage(event)),
						}),
					),
					// The editor is destroyed once its element has left the document: tearing it down
					// while still attached forces a synchronous layout of the whole page.
					(editor) => Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => editor.destroy()))),
				)
				// Registered after the editor exists, so it is released (unregistered) before the destroy.
				yield* editorRegistry.register(editorId, view)
				// Read-only while DevTools shows a historical view.
				yield* viewStateChanges.pipe(
					Stream.runForEach((viewState) =>
						Effect.sync(() => view.setProps({ editable: () => viewState === "Live" })),
					),
					Effect.forkScoped,
				)
				return yield* Effect.never
			}),
		),
})

/** Legacy `EditorAutocomplete`'s `onMouseDown`: pressing an option keeps the focus in the editor. */
export const PreventEditorBlur = Mount.define("PreventEditorBlur", {
	messages: [Message.CompletedPreventEditorBlur],
	execute: ({ element }) =>
		Effect.gen(function* () {
			const preventBlur = (event: Event) => event.preventDefault()
			yield* Effect.acquireRelease(
				Effect.sync(() => element.addEventListener("mousedown", preventBlur)),
				() => Effect.sync(() => element.removeEventListener("mousedown", preventBlur)),
			)
			return Message.CompletedPreventEditorBlur()
		}),
})

/** Legacy `EditorAutocomplete`'s sizing: the popover fits the space above the composer. */
export const FitAutocompleteHeight = Mount.define("FitAutocompleteHeight", {
	messages: [Message.CompletedFitAutocompleteHeight],
	execute: ({ element }) =>
		Effect.gen(function* () {
			const popover = element as HTMLElement
			const updateHeight = () => {
				const container = popover.parentElement?.getBoundingClientRect()
				if (container)
					popover.style.maxHeight = `${Math.min(Math.max(container.top - 16, 150), 400)}px`
			}
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					updateHeight()
					window.addEventListener("resize", updateHeight)
					window.addEventListener("scroll", updateHeight, { passive: true })
				}),
				() =>
					Effect.sync(() => {
						window.removeEventListener("resize", updateHeight)
						window.removeEventListener("scroll", updateHeight)
					}),
			)
			return Message.CompletedFitAutocompleteHeight()
		}),
})

// COMMAND

/**
 * Runs `f` on the live editor and settles into `completed`, or into `failed` with the reason when
 * the editor is not mounted (the Model still holds the draft, so nothing is lost) or `f` broke.
 */
export const onEditor = <C, F>(
	editorId: string,
	f: (view: EditorView) => void,
	completed: C,
	failed: (payload: { readonly reason: EditorFailure }) => F,
) =>
	withEditor(editorId, f).pipe(
		Effect.as(completed),
		Effect.catchTag("EditorNotMounted", () => Effect.succeed(failed({ reason: "EditorNotMounted" }))),
		catchCommon((reason) => failed({ reason })),
	)

export const InsertMention = Command.define("InsertMention", {
	// A user id, or "channel" / "here".
	args: { editorId: Schema.String, userId: Schema.String, displayName: Schema.String },
	messages: [Message.CompletedInsertMention, Message.FailedInsertMention],
	execute: ({ editorId, userId, displayName }) =>
		onEditor(
			editorId,
			(view) => insertMention(view, userId, displayName),
			Message.CompletedInsertMention(),
			Message.FailedInsertMention,
		),
})

export const SyncAutocompleteOptions = Command.define("SyncAutocompleteOptions", {
	args: {
		editorId: Schema.String,
		optionCount: Schema.Number,
		activeOptionId: Schema.NullOr(Schema.String),
	},
	messages: [Message.CompletedSyncAutocompleteOptions, Message.FailedSyncAutocompleteOptions],
	execute: ({ editorId, optionCount, activeOptionId }) =>
		onEditor(
			editorId,
			(view) => syncAutocompleteOptions(view, optionCount, activeOptionId),
			Message.CompletedSyncAutocompleteOptions(),
			Message.FailedSyncAutocompleteOptions,
		),
})

export const CloseAutocomplete = Command.define("CloseAutocomplete", {
	args: { editorId: Schema.String },
	messages: [Message.CompletedCloseAutocomplete, Message.FailedCloseAutocomplete],
	execute: ({ editorId }) =>
		onEditor(
			editorId,
			closeAutocomplete,
			Message.CompletedCloseAutocomplete(),
			Message.FailedCloseAutocomplete,
		),
})
