// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update, wiring } from "../test/kit-forms-fixtures"
import { switchControl, type SwitchOptions } from "./switch"

/** Switch: a native checkbox with role switch, toggled by its label like a Checkbox. */

const view =
	(options: Partial<SwitchOptions<Message>> = {}) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			switchControl(
				h,
				{
					id: "wifi",
					isSelected: model.isSelected,
					onChange: (isSelected) => Message.ChangedSelection({ isSelected }),
					interaction: wiring(model),
					...options,
				},
				"Wi-Fi",
			),
		])

const toggleSwitch = Scene.role("switch")
const control = Scene.selector("label")

describe("switch scene", () => {
	test("a switch renders role switch reflecting its selection", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init({ isSelected: true })),
			Scene.expect(toggleSwitch).toHaveAttr("type", "checkbox"),
			Scene.expect(toggleSwitch).toBeChecked(),
			Scene.expect(control).toHaveAttr("data-selected", "true"),
			Scene.expect(Scene.label("Wi-Fi")).toHaveId("wifi"),
		)
	})

	test("clicking the label turns the switch on and off", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.click(Scene.text("Wi-Fi")),
			Scene.expect(toggleSwitch).toBeChecked(),
			Scene.click(Scene.text("Wi-Fi")),
			Scene.expect(toggleSwitch).not.toBeChecked(),
			Scene.expect(control).not.toHaveAttr("data-selected"),
		)
	})

	test("Space on the focused switch flips it through the native change", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.focus(toggleSwitch),
			Scene.change(toggleSwitch, "on"),
			Scene.expect(toggleSwitch).toBeChecked(),
			Scene.expect(control).toHaveAttr("data-focus-visible", "true"),
		)
	})

	test("a pointer press marks the switch pressed and blocks text selection", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.pointerDown(control),
			Scene.expect(control).toHaveAttr("data-pressed", "true"),
			Scene.expect(control).toHaveAttr(
				"style",
				"-webkit-tap-highlight-color: transparent; user-select: none;",
			),
		)
	})

	test("a disabled switch is disabled with no click or hover handlers", () => {
		Scene.scene(
			{ update, view: view({ isDisabled: true }) },
			Scene.given(init()),
			Scene.expect(toggleSwitch).toBeDisabled(),
			Scene.expect(control).toHaveAttr("data-disabled", "true"),
			Scene.expect(control).not.toHaveHandler("click"),
			Scene.expect(control).not.toHaveHandler("mouseenter"),
		)
	})
})
