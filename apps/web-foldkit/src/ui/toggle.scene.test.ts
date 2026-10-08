// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update, wiring } from "../test/kit-forms-fixtures"
import { toggle } from "./toggle"

/** ToggleButton: aria-pressed follows the parent's selection, pressing flips it. */

const view =
	(isDisabled = false) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			toggle(
				h,
				{
					isSelected: model.isSelected,
					onPress: Message.ChangedSelection({ isSelected: !model.isSelected }),
					interaction: { wiring: wiring(model), target: "bold" },
					isDisabled,
				},
				["Bold"],
			),
		])

const bold = Scene.role("button", { name: "Bold" })

describe("toggle scene", () => {
	test("an unselected toggle is a button with aria-pressed false", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.expect(bold).toHaveAttr("type", "button"),
			Scene.expect(bold).toHaveAttr("aria-pressed", "false"),
			Scene.expect(bold).not.toHaveAttr("data-selected"),
		)
	})

	test("clicking the toggle selects it and clicking again deselects it", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.click(bold),
			Scene.expect(bold).toHaveAttr("aria-pressed", "true"),
			Scene.expect(bold).toHaveAttr("data-selected", "true"),
			Scene.click(bold),
			Scene.expect(bold).toHaveAttr("aria-pressed", "false"),
		)
	})

	test("holding Space shows the pressed state before the click lands", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.keydown(bold, " "),
			Scene.expect(bold).toHaveAttr("data-pressed", "true"),
			Scene.expect(bold).toHaveAttr("aria-pressed", "false"),
		)
	})

	test("hover and keyboard focus show data-hovered and data-focus-visible", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.hover(bold),
			Scene.focus(bold),
			Scene.expect(bold).toHaveAttr("data-hovered", "true"),
			Scene.expect(bold).toHaveAttr("data-focus-visible", "true"),
		)
	})

	test("a disabled toggle is disabled and shows no interaction state even when hovered in the Model", () => {
		const hovered = init({
			interaction: { ...init().interaction, hovered: ["bold"] },
		})
		Scene.scene(
			{ update, view: view(true) },
			Scene.given(hovered),
			Scene.expect(bold).toBeDisabled(),
			Scene.expect(bold).toHaveAttr("data-disabled", "true"),
			Scene.expect(bold).not.toHaveAttr("data-hovered"),
			Scene.expect(bold).not.toHaveHandler("click"),
		)
	})
})
