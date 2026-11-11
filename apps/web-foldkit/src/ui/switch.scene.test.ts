// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update } from "../test/kit-forms-fixtures"
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

	test("Space on the switch flips it through the native change", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.change(toggleSwitch, "on"),
			Scene.expect(toggleSwitch).toBeChecked(),
		)
	})

	test("the keyboard focus ring and hover are native CSS on the label, with no wiring", () => {
		const track = Scene.selector(`[data-slot="indicator"]`)
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.expect(control).toHaveClass("group"),
			Scene.expect(track).toHaveClass("group-has-focus-visible:ring-2"),
			Scene.expect(track).toHaveClass("group-hover:inset-ring-muted-fg/30"),
		)
	})

	test("a disabled switch is disabled with no click handler", () => {
		Scene.scene(
			{ update, view: view({ isDisabled: true }) },
			Scene.given(init()),
			Scene.expect(toggleSwitch).toBeDisabled(),
			Scene.expect(control).toHaveAttr("data-disabled", "true"),
			Scene.expect(control).not.toHaveHandler("click"),
		)
	})
})
