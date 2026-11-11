// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Composer from "./composer"
import { update } from "./update"
import { composerBoxView } from "./view"

/** The bare composer through its view: the editor's mount arguments and the autocomplete's accessibility. */

const editorId = "composer-scene"
const config = {
	update,
	view: (model: Composer.Model, h: HtmlBuilder<Composer.Message>) =>
		composerBoxView(h, model, { toMessage: (message) => message }),
}
const grace: Composer.MentionMember = {
	userId: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001"),
	firstName: "Grace",
	lastName: "Hopper",
	avatarUrl: null,
}

describe("composer view", () => {
	test("a remounted editor starts from the draft the Model holds", () => {
		Scene.scene(
			config,
			Scene.given<Composer.Model>({ ...Composer.init(editorId), markdown: "Half-written **reply**" }),
			Scene.Mount.expectHas(
				Composer.MountEditor({
					editorId,
					placeholder: "Type a message...",
					initialMarkdown: "Half-written **reply**",
				}),
			),
			Scene.Mount.resolve(
				Composer.MountEditor,
				Composer.Message.UpdatedDraft({ markdown: "Half-written **reply**", isEmpty: false }),
			),
		)
	})

	test("the autocomplete is a labelled listbox whose options have ids; no hidden drop zone button", () => {
		Scene.scene(
			config,
			Scene.given<Composer.Model>({
				...Composer.init(editorId),
				members: [grace],
				autocomplete: { trigger: "mention", search: "gra" },
			}),
			Scene.Mount.resolveAll(
				[
					{ name: "MountEditor" },
					Composer.Message.UpdatedDraft({ markdown: "@gra", isEmpty: false }),
				],
				[{ name: "FitAutocompleteHeight" }, Composer.Message.CompletedFitAutocompleteHeight()],
				[{ name: "PreventEditorBlur" }, Composer.Message.CompletedPreventEditorBlur()],
			),
			Scene.expect(Scene.selector(`#${Composer.listboxId(editorId)}`)).toHaveAttr("role", "listbox"),
			Scene.expect(Scene.selector(`#${Composer.optionDomId(editorId, 0)}`)).toHaveAttr(
				"aria-selected",
				"true",
			),
			Scene.expect(Scene.role("button", { name: "DropZone" })).toBeAbsent(),
		)
	})
})
