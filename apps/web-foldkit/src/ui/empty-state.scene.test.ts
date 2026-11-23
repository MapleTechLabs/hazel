// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, type Message, type Model, page, update } from "../test/kit-forms-fixtures"
import { emptyState } from "./empty-state"

/** Empty and failed states: a failure the person waits on is announced, a quiet empty one is not. */

const view = (role?: "alert" | "status") => (_model: Model, h: HtmlBuilder<Message>) =>
	page(h, [
		emptyState(h, {
			title: "Couldn't preview this rule",
			description: "Check your connection and try again.",
			role,
			className: "empty",
		}),
	])

const state = Scene.selector(".empty")

describe("emptyState scene", () => {
	test("a failure with role alert is announced", () => {
		Scene.scene(
			{ update, view: view("alert") },
			Scene.given(init()),
			Scene.expect(state).toHaveAttr("role", "alert"),
			Scene.expect(Scene.text("Couldn't preview this rule")).toExist(),
		)
	})

	test("a plain empty state carries no live role", () => {
		Scene.scene({ update, view: view() }, Scene.given(init()), Scene.expect(state).not.toHaveAttr("role"))
	})
})
