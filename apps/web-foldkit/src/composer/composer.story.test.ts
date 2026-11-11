import { BotCommandId, BotId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "./composer"
import * as EditorCommands from "./editor-commands"
import { update } from "./update"

/** The composer Submodel's own update: the draft text, mention autocomplete, slash commands and the editor sync. */

// ProseMirror's view reads `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const editorId = "composer-test"
const { Message } = Composer

const members: ReadonlyArray<Composer.MentionMember> = [
	{ userId: Schema.decodeSync(UserId)(uuid(1)), firstName: "Grace", lastName: "Hopper", avatarUrl: null },
	{ userId: Schema.decodeSync(UserId)(uuid(2)), firstName: "Alan", lastName: "Turing", avatarUrl: null },
]

const withMembers = (): Composer.Model => ({ ...Composer.init(editorId), members })

const deployCommand: Composer.BotCommand = {
	id: Schema.decodeSync(BotCommandId)(uuid(3)),
	name: "deploy",
	description: "Deploy a branch",
	bot: { id: Schema.decodeSync(BotId)(uuid(4)), name: "CI", avatarUrl: null },
	arguments: [
		{ name: "branch", description: null, required: true, placeholder: null, type: "string" },
		{ name: "env", description: null, required: false, placeholder: null, type: "string" },
	],
}

describe("the draft text", () => {
	test("the Model owns what the editor reports, so a remounted editor starts from it", () => {
		story(
			update,
			given(Composer.init(editorId)),
			message(Message.UpdatedDraft({ markdown: "Hello **team**", isEmpty: false })),
			Command.expectNone(),
			model((current) => expect(current.markdown).toBe("Hello **team**")),
		)
	})

	test("an editor that is not mounted fails the Command; the Model keeps the draft", () => {
		const drafted: Composer.Model = { ...Composer.init(editorId), markdown: "kept" }
		story(
			update,
			given(drafted),
			message(Message.FailedSetEditorContent({ reason: "EditorNotMounted" })),
			Command.expectNone(),
			model((current) => expect(current.markdown).toBe("kept")),
		)
	})
})

describe("mention autocomplete", () => {
	test("moving through the options tells the editor which one is active (aria-activedescendant)", () => {
		story(
			update,
			given(withMembers()),
			message(Message.ChangedAutocomplete({ autocomplete: { trigger: "mention", search: "" } })),
			Command.expectExact(
				Composer.SyncAutocompleteOptions({
					editorId,
					optionCount: 4,
					activeOptionId: Composer.optionDomId(editorId, 0),
				}),
			),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
			message(Message.PressedAutocompleteKey({ key: "ArrowDown" })),
			Command.expectExact(
				Composer.SyncAutocompleteOptions({
					editorId,
					optionCount: 4,
					activeOptionId: Composer.optionDomId(editorId, 1),
				}),
			),
			Command.resolve(Composer.SyncAutocompleteOptions, Message.CompletedSyncAutocompleteOptions()),
			model((current) => expect(current.activeIndex).toBe(1)),
		)
	})

	test("Enter inserts the active member", () => {
		story(
			update,
			given({ ...withMembers(), autocomplete: { trigger: "mention", search: "gra" } }),
			message(Message.PressedAutocompleteKey({ key: "Enter" })),
			Command.expectExact(
				Composer.InsertMention({ editorId, userId: uuid(1), displayName: "Grace Hopper" }),
			),
			Command.resolve(Composer.InsertMention, Message.CompletedInsertMention()),
		)
	})
})

describe("slash commands", () => {
	test("picking a command opens its argument panel, idle, with the first field focused", () => {
		story(
			update,
			given({
				...Composer.init(editorId),
				botCommands: [deployCommand],
				autocomplete: { trigger: "command", search: "" },
			}),
			message(Message.ClickedAutocompleteOption({ index: 0 })),
			Command.expectExact(
				EditorCommands.RemoveTriggerText({ editorId }),
				EditorCommands.FocusCommandField({ editorId, index: 0 }),
			),
			Command.resolve(EditorCommands.RemoveTriggerText, Message.CompletedRemoveTriggerText()),
			Command.resolve(EditorCommands.FocusCommandField, Message.CompletedFocusCommandField()),
			model((current) =>
				expect(current.commandInput).toEqual({
					command: deployCommand,
					values: {},
					submission: "Idle",
				}),
			),
		)
	})

	test("Tab moves the focus to the next field without touching the Model", () => {
		const input: Composer.Model = {
			...Composer.init(editorId),
			commandInput: { command: deployCommand, values: {}, submission: "Idle" },
		}
		story(
			update,
			given(input),
			message(Message.PressedCommandFieldKey({ index: 0, key: "Tab", shiftKey: false })),
			Command.expectExact(EditorCommands.FocusCommandField({ editorId, index: 1 })),
			Command.resolve(EditorCommands.FocusCommandField, Message.CompletedFocusCommandField()),
			model((current) => expect(current).toBe(input)),
		)
	})
})
