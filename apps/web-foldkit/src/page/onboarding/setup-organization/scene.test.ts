// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { newcomer } from "../../../test/pages-entry-fixtures"
import { pageScene } from "../../../test/pages-fixtures"
import * as CreateWorkspace from "../../create-workspace"
import { update, view } from "./index"

/** `/onboarding/setup-organization`: name the workspace; its URL follows the name until edited. */

const empty = { form: CreateWorkspace.init() }
const create = Scene.role("button", { name: "Create workspace" })

describe("setup organization", () => {
	test("creates the workspace with the slug derived from its name", () => {
		Scene.scene(
			pageScene(update, view, newcomer),
			Scene.given(empty),
			Scene.type(Scene.label("Workspace name"), "Acme Corp!"),
			Scene.expect(Scene.label("Workspace URL")).toHaveValue("acme-corp"),
			Scene.click(create),
			Scene.Command.expectExact(
				CreateWorkspace.CreateWorkspace({ name: "Acme Corp!", slug: "acme-corp" }),
			),
			Scene.Command.resolve(
				CreateWorkspace.CreateWorkspace,
				CreateWorkspace.Message.FailedCreateWorkspace({ reason: "SlugTaken" }),
			),
			Scene.expect(Scene.role("alert")).toHaveText("That workspace URL is taken. Pick another."),
			Scene.expect(create).toBeEnabled(),
		)
	})

	test("an invalid URL blocks the submit and says why", () => {
		Scene.scene(
			pageScene(update, view, newcomer),
			Scene.given(empty),
			Scene.type(Scene.label("Workspace name"), "Acme"),
			Scene.type(Scene.label("Workspace URL"), "a!"),
			Scene.click(create),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Use at least 3 lowercase letters, numbers or hyphens")).toExist(),
		)
	})
})
