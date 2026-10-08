import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "./composer"
import * as EditorCommands from "./editor-commands"
import { update } from "./update"

/** The composer Submodel's own update: mention autocomplete, slash commands and the editor sync. */

// ProseMirror's view reads `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, { document: Object.assign(new EventTarget(), { documentElement: { style: {} } }) })
})

const editorId = "composer-test"
const { Message } = Composer

const members = [
	{ userId: "user-grace", firstName: "Grace", lastName: "Hopper", avatarUrl: null },
	{ userId: "user-alan", firstName: "Alan", lastName: "Turing", avatarUrl: null },
]

const withMembers = (): Composer.Model => ({ ...Composer.init(editorId), members })

const deployCommand: Composer.BotCommand = {
	id: "command-deploy",
	name: "deploy",
	description: "Deploy a branch",
	bot: { id: "bot-ci", name: "CI", avatarUrl: null },
	arguments: [
		{ name: "branch", description: null, required: true, placeholder: null, type: "string" },
		{ name: "env", description: null, required: false, placeholder: null, type: "string" },
	],
}

describe("composer draft", () => {
	test("editor changes are mirrored into the Model without Commands", () => {
		story(
			update,
			given(Composer.init(editorId)),
			message(Message.UpdatedDraft({ markdown: "Hello", isEmpty: false })),
			Command.expectNone(),
			model((current) => {
				expect(current.markdown).toBe("Hello")
				expect(current.isEmpty).toBe(false)
			}),
		)
	})
})

describe("mention autocomplete", () => {
	test("opening @ syncs the option count to the editor so it captures the arrow keys", () => {
		story(
			update,
			given(withMembers()),
			message(Message.ChangedAutocomplete({ autocomplete: { trigger: "mention", search: "" } })),
			// @channel, @here and the two members.
			Command.expectExact(Composer.SyncAutocompleteOptions({ editorId, optionCount: 4 })),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
		)
	})

	test("the search filters members; ArrowDown wraps and Enter inserts the active mention", () => {
		story(
			update,
			given(withMembers()),
			message(Message.ChangedAutocomplete({ autocomplete: { trigger: "mention", search: "gr" } })),
			Command.expectExact(Composer.SyncAutocompleteOptions({ editorId, optionCount: 1 })),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
			message(Message.PressedAutocompleteKey({ key: "ArrowDown" })),
			model((current) => expect(current.activeIndex).toBe(0)),
			message(Message.PressedAutocompleteKey({ key: "Enter" })),
			Command.expectExact(Composer.InsertMention({ editorId, userId: "user-grace", displayName: "Grace Hopper" })),
			Command.resolve(Composer.InsertMention, Message.CompletedInsertMention()),
		)
	})

	test("ArrowUp from the first option wraps to the last", () => {
		story(
			update,
			given({ ...withMembers(), autocomplete: { trigger: "mention", search: "" } }),
			message(Message.PressedAutocompleteKey({ key: "ArrowUp" })),
			model((current) => expect(current.activeIndex).toBe(3)),
		)
	})

	test("clicking an option inserts it and resets the active index", () => {
		story(
			update,
			given({ ...withMembers(), autocomplete: { trigger: "mention", search: "" }, activeIndex: 2 }),
			message(Message.ClickedAutocompleteOption({ index: 0 })),
			Command.expectExact(Composer.InsertMention({ editorId, userId: "channel", displayName: "channel" })),
			Command.resolve(Composer.InsertMention, Message.CompletedInsertMention()),
			model((current) => expect(current.activeIndex).toBe(0)),
		)
	})

	test("Escape closes the popover in the editor", () => {
		story(
			update,
			given({ ...withMembers(), autocomplete: { trigger: "mention", search: "" } }),
			message(Message.PressedAutocompleteKey({ key: "Escape" })),
			Command.expectExact(Composer.CloseAutocomplete({ editorId })),
			Command.resolve(Composer.CloseAutocomplete, Message.CompletedCloseAutocomplete()),
		)
	})

	test("closing the trigger resets the active index", () => {
		story(
			update,
			given({ ...withMembers(), autocomplete: { trigger: "mention", search: "" }, activeIndex: 3 }),
			message(Message.ChangedAutocomplete({ autocomplete: null })),
			Command.expectExact(Composer.SyncAutocompleteOptions({ editorId, optionCount: 0 })),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
			model((current) => expect(current.activeIndex).toBe(0)),
		)
	})

	test("members arriving while the popover is open resync the count", () => {
		story(
			update,
			given({ ...Composer.init(editorId), autocomplete: { trigger: "mention", search: "" } }),
			message(Message.UpdatedMentionMembers({ members })),
			Command.expectExact(Composer.SyncAutocompleteOptions({ editorId, optionCount: 4 })),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
		)
	})
})

describe("slash commands", () => {
	const withCommand = (): Composer.Model => ({
		...Composer.init(editorId),
		botCommands: [deployCommand],
		autocomplete: { trigger: "command", search: "dep" },
	})

	test("selecting a command removes the /query and opens its argument fields", () => {
		story(
			update,
			given(withCommand()),
			message(Message.PressedAutocompleteKey({ key: "Enter" })),
			Command.expectExact(
				EditorCommands.RemoveTriggerText({ editorId }),
				EditorCommands.FocusCommandField({ editorId, index: 0 }),
			),
			Command.resolve(EditorCommands.RemoveTriggerText, Message.CompletedRemoveTriggerText()),
			Command.resolve(EditorCommands.FocusCommandField, Message.CompletedFocusCommandField()),
			model((current) => {
				expect(current.commandInput?.command.name).toBe("deploy")
				expect(current.commandInput?.focusedFieldIndex).toBe(0)
			}),
		)
	})

	test("Tab moves between fields within bounds; typed values are kept per argument", () => {
		story(
			update,
			given({ ...withCommand(), commandInput: { command: deployCommand, values: {}, focusedFieldIndex: 0 } }),
			message(Message.UpdatedCommandValue({ argName: "branch", value: "main" })),
			message(Message.PressedCommandFieldKey({ index: 0, key: "Tab", shiftKey: false })),
			Command.expectExact(EditorCommands.FocusCommandField({ editorId, index: 1 })),
			Command.resolve(EditorCommands.FocusCommandField, Message.CompletedFocusCommandField()),
			// The last field does not move past the end.
			message(Message.PressedCommandFieldKey({ index: 1, key: "Tab", shiftKey: false })),
			Command.expectExact(EditorCommands.FocusCommandField({ editorId, index: 1 })),
			Command.resolve(EditorCommands.FocusCommandField, Message.CompletedFocusCommandField()),
			model((current) => {
				expect(current.commandInput?.values).toEqual({ branch: "main" })
				expect(current.commandInput?.focusedFieldIndex).toBe(1)
			}),
		)
	})

	test("Escape in a field cancels the command and focuses the editor", () => {
		story(
			update,
			given({ ...withCommand(), commandInput: { command: deployCommand, values: {}, focusedFieldIndex: 0 } }),
			message(Message.PressedCommandFieldKey({ index: 0, key: "Escape", shiftKey: false })),
			Command.expectExact(EditorCommands.FocusEditor({ editorId })),
			Command.resolve(EditorCommands.FocusEditor, Message.CompletedFocusEditor()),
			model((current) => expect(current.commandInput).toBeNull()),
		)
	})
})
