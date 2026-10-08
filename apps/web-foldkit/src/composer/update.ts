import { Match } from "effect"
import type { Update } from "foldkit"
import { CloseAutocomplete, InsertMention, Message, type Model, SyncAutocompleteOptions } from "./composer"
import { FocusCommandField, FocusEditor, InsertEmoji, RemoveTriggerText } from "./editor-commands"
import { clampedActiveIndex, commandOptions, emojiOptions, mentionOptions, optionCount } from "./options"

/** The composer's own update: the autocomplete listbox, trigger selection and command input fields. */

export { clampedActiveIndex, mentionOptions, type MentionOption } from "./options"

type Return = Update.Return<Model, Message>

/** Keep the editor's key capture in step with what the popover shows. */
const withOptionSync = (previous: Model, model: Model): Return =>
	optionCount(previous) === optionCount(model)
		? { model }
		: { model, commands: [SyncAutocompleteOptions({ editorId: model.editorId, optionCount: optionCount(model) })] }

/** Legacy `handleSelectByIndex`, routed by trigger. */
const select = (model: Model, index: number): Return => {
	const editorId = model.editorId
	const reset = { ...model, activeIndex: 0 }
	const trigger = model.autocomplete?.trigger
	if (trigger === "mention") {
		const option = mentionOptions(model)[index]
		return option
			? { model: reset, commands: [InsertMention({ editorId, userId: option.id, displayName: option.displayName })] }
			: { model }
	}
	if (trigger === "command") {
		const option = commandOptions(model)[index]
		// Command input mode (Discord-style): the `/query` text goes, the argument panel opens.
		return option
			? {
					model: { ...reset, commandInput: { command: option.command, values: {}, focusedFieldIndex: 0 } },
					commands: [RemoveTriggerText({ editorId }), FocusCommandField({ editorId, index: 0 })],
				}
			: { model }
	}
	const option = emojiOptions(model)[index]
	return option
		? {
				model: reset,
				commands: [
					InsertEmoji({
						editorId,
						emoji: option.emoji,
						custom: option.imageUrl === null ? null : { name: option.name, imageUrl: option.imageUrl },
					}),
				],
			}
		: { model }
}

const focusField = (model: Model, index: number): Return =>
	model.commandInput === null
		? { model }
		: {
				model: { ...model, commandInput: { ...model.commandInput, focusedFieldIndex: index } },
				commands: [FocusCommandField({ editorId: model.editorId, index })],
			}

/** `handleCommandCancel`: leave input mode and focus the editor. */
export const cancelCommand = (model: Model): Return => ({
	model: { ...model, commandInput: null },
	commands: [FocusEditor({ editorId: model.editorId })],
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		// The editor owns its document; the draft reads the markdown for typing (`draft-update.ts`).
		UpdatedDraft: () => ({ model }),
		ChangedAutocomplete: ({ autocomplete }) =>
			withOptionSync(model, { ...model, autocomplete, activeIndex: autocomplete === null ? 0 : model.activeIndex }),
		PressedAutocompleteKey: ({ key }) => {
			const count = optionCount(model)
			const index = clampedActiveIndex(model)
			return Match.value(key).pipe(
				Match.when("ArrowDown", (): Return => ({ model: { ...model, activeIndex: index >= count - 1 ? 0 : index + 1 } })),
				Match.when("ArrowUp", (): Return => ({ model: { ...model, activeIndex: index <= 0 ? count - 1 : index - 1 } })),
				Match.whenOr("Enter", "Tab", () => select(model, index)),
				Match.when("Escape", (): Return => ({ model, commands: [CloseAutocomplete({ editorId: model.editorId })] })),
				Match.exhaustive,
			)
		},
		HoveredAutocompleteOption: ({ index }) => ({ model: { ...model, activeIndex: index } }),
		ClickedAutocompleteOption: ({ index }) => select(model, index),
		UpdatedMentionMembers: ({ members }) => withOptionSync(model, { ...model, members }),
		UpdatedPresence: ({ presence }) => ({ model: { ...model, presence } }),
		UpdatedMentionableBots: ({ bots }) => withOptionSync(model, { ...model, mentionableBots: bots }),
		UpdatedBotCommands: ({ commands }) => withOptionSync(model, { ...model, botCommands: commands }),
		UpdatedCustomEmojis: ({ emojis }) => withOptionSync(model, { ...model, customEmojis: emojis }),
		UpdatedCommandValue: ({ argName, value }) =>
			model.commandInput === null
				? { model }
				: {
						model: {
							...model,
							commandInput: { ...model.commandInput, values: { ...model.commandInput.values, [argName]: value } },
						},
					},
		FocusedCommandField: ({ index }) =>
			model.commandInput === null
				? { model }
				: { model: { ...model, commandInput: { ...model.commandInput, focusedFieldIndex: index } } },
		// `CommandInputPanel.handleKeyDown`: Tab moves between fields; Enter and Escape reach the draft.
		PressedCommandFieldKey: ({ index, key, shiftKey }) => {
			const last = (model.commandInput?.command.arguments.length ?? 1) - 1
			if (key === "Tab") return focusField(model, shiftKey ? Math.max(0, index - 1) : Math.min(last, index + 1))
			return key === "Escape" ? cancelCommand(model) : { model }
		},
		// The draft executes (it knows the organization and channel).
		ClickedExecuteCommand: () => ({ model }),
		ClickedCancelCommand: () => cancelCommand(model),
		// The draft (`draft-update.ts`) acts on these; a bare composer (the gallery) ignores them.
		SubmittedDraft: () => ({ model }),
		PressedEscape: () => ({ model }),
		PressedArrowUpInEmpty: () => ({ model }),
		PastedFiles: () => ({ model }),
		CompletedInsertMention: () => ({ model }),
		CompletedSyncAutocompleteOptions: () => ({ model }),
		CompletedCloseAutocomplete: () => ({ model }),
		CompletedKeepEditorFocus: () => ({ model }),
		CompletedSetEditorContent: () => ({ model }),
		CompletedClearEditor: () => ({ model }),
		CompletedFocusEditor: () => ({ model }),
		CompletedInsertEditorText: () => ({ model }),
		CompletedInsertCustomEmoji: () => ({ model }),
		CompletedInsertEmoji: () => ({ model }),
		CompletedRemoveTriggerText: () => ({ model }),
		CompletedFocusCommandField: () => ({ model }),
	})
