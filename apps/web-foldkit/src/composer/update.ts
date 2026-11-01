import { Match } from "effect"
import type { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { EditorRegistry } from "../editor/registry"
import {
	CloseAutocomplete,
	InsertMention,
	Message,
	type CommandInput,
	type CommandSubmission,
	type Model,
	optionDomId,
	SyncAutocompleteOptions,
} from "./composer"
import {
	ClearEditor,
	FocusCommandField,
	FocusEditor,
	InsertEmoji,
	RemoveTriggerText,
	SetEditorContent,
} from "./editor-commands"
import { clampedActiveIndex, commandOptions, emojiOptions, mentionOptions, optionCount } from "./options"

/** The composer's own update: the draft text, the autocomplete listbox, trigger selection and command input fields. */

export { clampedActiveIndex, mentionOptions, type MentionOption } from "./options"

export type Return = Update.Return<Model, Message, EditorRegistry>

const activeOptionIdOf = (model: Model) =>
	optionCount(model) === 0 ? null : optionDomId(model.editorId, clampedActiveIndex(model))

/** Keep the editor's key capture and `aria-activedescendant` in step with what the popover shows. */
const withOptionSync = (previous: Model, model: Model): Return =>
	optionCount(previous) === optionCount(model) && activeOptionIdOf(previous) === activeOptionIdOf(model)
		? { model }
		: {
				model,
				commands: [
					SyncAutocompleteOptions({
						editorId: model.editorId,
						optionCount: optionCount(model),
						activeOptionId: activeOptionIdOf(model),
					}),
				],
			}

/** Replace the draft: the Model first, then the live editor (if it is mounted). */
export const setDraft = (model: Model, markdown: string): Return => ({
	model: modifyFields(model, { markdown: () => markdown }),
	commands: [SetEditorContent({ editorId: model.editorId, markdown })],
})

/** Empty the draft. */
export const clearDraft = (model: Model): Return => ({
	model: modifyFields(model, { markdown: () => "" }),
	commands: [ClearEditor({ editorId: model.editorId })],
})

/** Legacy `handleSelectByIndex`, routed by trigger. */
const select = (model: Model, index: number): Return => {
	const editorId = model.editorId
	const reset = modifyFields(model, { activeIndex: () => 0 })
	return Match.value(model.autocomplete?.trigger).pipe(
		Match.withReturnType<Return>(),
		Match.when("mention", () => {
			const option = mentionOptions(model)[index]
			return option
				? {
						model: reset,
						commands: [
							InsertMention({ editorId, userId: option.id, displayName: option.displayName }),
						],
					}
				: { model }
		}),
		// Command input mode (Discord-style): the `/query` text goes, the argument panel opens.
		Match.when("command", () => {
			const option = commandOptions(model)[index]
			return option
				? {
						model: modifyFields(reset, {
							commandInput: () => ({
								command: option.command,
								values: {},
								submission: "Idle" as const,
							}),
						}),
						commands: [
							RemoveTriggerText({ editorId }),
							FocusCommandField({ editorId, index: 0 }),
						],
					}
				: { model }
		}),
		Match.when("emoji", () => {
			const option = emojiOptions(model)[index]
			return option
				? {
						model: reset,
						commands: [
							InsertEmoji({
								editorId,
								emoji: option.emoji,
								custom:
									option.imageUrl === null
										? null
										: { name: option.name, imageUrl: option.imageUrl },
							}),
						],
					}
				: { model }
		}),
		Match.when(undefined, () => ({ model })),
		Match.exhaustive,
	)
}

/** `handleCommandCancel`: leave input mode and focus the editor. */
export const cancelCommand = (model: Model): Return => ({
	model: modifyFields(model, { commandInput: () => null }),
	commands: [FocusEditor({ editorId: model.editorId })],
})

/** Edit the open command input (nothing without one). */
const modifyCommandInput = (model: Model, f: (input: CommandInput) => CommandInput): Model =>
	modifyFields(model, { commandInput: (input) => (input === null ? null : f(input)) })

/** Mark the command's Execute as in flight (or settled). */
export const setCommandSubmission = (model: Model, submission: CommandSubmission): Model =>
	modifyCommandInput(model, (input) => modifyFields(input, { submission: () => submission }))

const noChange = (model: Model): Return => ({ model })

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedDraft: ({ markdown }) => ({ model: modifyFields(model, { markdown: () => markdown }) }),
		ChangedAutocomplete: ({ autocomplete }) =>
			withOptionSync(
				model,
				modifyFields(model, {
					autocomplete: () => autocomplete,
					activeIndex: (index) => (autocomplete === null ? 0 : index),
				}),
			),
		PressedAutocompleteKey: ({ key }) => {
			const count = optionCount(model)
			const index = clampedActiveIndex(model)
			const moveTo = (next: number) =>
				withOptionSync(model, modifyFields(model, { activeIndex: () => next }))
			return Match.value(key).pipe(
				Match.when("ArrowDown", () => moveTo(index >= count - 1 ? 0 : index + 1)),
				Match.when("ArrowUp", () => moveTo(index <= 0 ? count - 1 : index - 1)),
				Match.whenOr("Enter", "Tab", () => select(model, index)),
				Match.when("Escape", (): Return => ({
					model,
					commands: [CloseAutocomplete({ editorId: model.editorId })],
				})),
				Match.exhaustive,
			)
		},
		HoveredAutocompleteOption: ({ index }) =>
			withOptionSync(model, modifyFields(model, { activeIndex: () => index })),
		ClickedAutocompleteOption: ({ index }) => select(model, index),
		UpdatedMentionMembers: ({ members }) =>
			withOptionSync(model, modifyFields(model, { members: () => members })),
		UpdatedPresence: ({ presence }) => ({ model: modifyFields(model, { presence: () => presence }) }),
		UpdatedMentionableBots: ({ bots }) =>
			withOptionSync(model, modifyFields(model, { mentionableBots: () => bots })),
		UpdatedBotCommands: ({ commands }) =>
			withOptionSync(model, modifyFields(model, { botCommands: () => commands })),
		UpdatedCustomEmojis: ({ emojis }) =>
			withOptionSync(model, modifyFields(model, { customEmojis: () => emojis })),
		UpdatedCommandValue: ({ argName, value }) => ({
			model: modifyCommandInput(model, (input) =>
				modifyFields(input, { values: (values) => ({ ...values, [argName]: value }) }),
			),
		}),
		// `CommandInputPanel.handleKeyDown`: Tab moves between fields; Enter and Escape reach the draft.
		PressedCommandFieldKey: ({ index, key, shiftKey }) => {
			if (model.commandInput === null) return { model }
			const last = model.commandInput.command.arguments.length - 1
			if (key === "Tab") {
				const next = shiftKey ? Math.max(0, index - 1) : Math.min(last, index + 1)
				return { model, commands: [FocusCommandField({ editorId: model.editorId, index: next })] }
			}
			return key === "Escape" ? cancelCommand(model) : { model }
		},
		// The draft executes (it knows the organization and channel).
		ClickedExecuteCommand: () => ({ model }),
		ClickedCancelCommand: () => cancelCommand(model),
		// The draft (`draft-update.ts`) acts on these; the bare composer ignores them.
		SubmittedDraft: () => ({ model }),
		PressedEscape: () => ({ model }),
		PressedArrowUpInEmpty: () => ({ model }),
		PastedFiles: () => ({ model }),
		CompletedPreventEditorBlur: () => noChange(model),
		CompletedFitAutocompleteHeight: () => noChange(model),
		CompletedInsertMention: () => noChange(model),
		CompletedSyncAutocompleteOptions: () => noChange(model),
		CompletedCloseAutocomplete: () => noChange(model),
		CompletedSetEditorContent: () => noChange(model),
		CompletedClearEditor: () => noChange(model),
		CompletedFocusEditor: () => noChange(model),
		CompletedInsertEditorText: () => noChange(model),
		CompletedInsertCustomEmoji: () => noChange(model),
		CompletedInsertEmoji: () => noChange(model),
		CompletedRemoveTriggerText: () => noChange(model),
		CompletedFocusCommandField: () => noChange(model),
		// The Model already holds the draft (`setDraft`, `clearDraft`), and an unmounted editor has no
		// autocomplete or caret to act on; the next mount starts from the Model.
		FailedInsertMention: () => noChange(model),
		FailedSyncAutocompleteOptions: () => noChange(model),
		FailedCloseAutocomplete: () => noChange(model),
		FailedSetEditorContent: () => noChange(model),
		FailedClearEditor: () => noChange(model),
		FailedInsertEditorText: () => noChange(model),
		FailedInsertCustomEmoji: () => noChange(model),
		FailedInsertEmoji: () => noChange(model),
		FailedRemoveTriggerText: () => noChange(model),
	})
