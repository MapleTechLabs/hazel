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
	test("editor changes leave the composer Model alone and send no Commands", () => {
		const initial = Composer.init(editorId)
		story(
			update,
			given(initial),
			message(Message.UpdatedDraft({ markdown: "Hello", isEmpty: false })),
			Command.expectNone(),
			model((current) => expect(current).toBe(initial)),
		)
	})
})
