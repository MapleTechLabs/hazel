// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update } from "../test/kit-forms-fixtures"
import { checkbox, type CheckboxOptions } from "./checkbox"

/** Checkbox through a parent that owns the value. */

const view =
	(options: Partial<CheckboxOptions<Message>> = {}) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			checkbox(
				h,
				{
					id: "notify",
					isSelected: model.isSelected,
					onChange: (isSelected) => Message.ChangedSelection({ isSelected }),
					...options,
				},
				"Notify me",
			),
		])

/** The input by id: the label locator needs exact label text and the check icon adds to it. */
const box = Scene.selector("#notify")
const control = Scene.selector("label")

describe("checkbox scene", () => {
	test("an unchecked checkbox renders a native checkbox that is not checked", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.expect(box).toHaveAttr("type", "checkbox"),
			Scene.expect(box).not.toBeChecked(),
			Scene.expect(control).not.toHaveAttr("data-selected"),
		)
	})

	test("clicking the label checks the box and clicking again unchecks it", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.click(Scene.text("Notify me")),
			Scene.expect(box).toBeChecked(),
			Scene.expect(control).toHaveAttr("data-selected", "true"),
			Scene.click(Scene.text("Notify me")),
			Scene.expect(box).not.toBeChecked(),
		)
	})

	test("Space on the focused input toggles it through the native change", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.change(box, "on"),
			Scene.expect(box).toBeChecked(),
		)
	})

	test("hover and the keyboard focus ring are native CSS on the label, with no wiring", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.expect(control).toHaveClass("group"),
			Scene.expect(Scene.selector(`[data-slot="indicator"]`)).toHaveClass(
				"group-hover:inset-ring-muted-fg/30",
			),
			Scene.expect(Scene.selector(`[data-slot="indicator"]`)).toHaveClass(
				"group-has-focus-visible:ring-3",
			),
		)
	})

	test("a disabled checkbox is disabled and ignores clicks", () => {
		Scene.scene(
			{ update, view: view({ isDisabled: true }) },
			Scene.given(init()),
			Scene.expect(box).toBeDisabled(),
			Scene.expect(control).toHaveAttr("data-disabled", "true"),
			Scene.expect(control).not.toHaveHandler("click"),
		)
	})

	test("an indeterminate checkbox is marked indeterminate and an invalid one aria-invalid", () => {
		Scene.scene(
			{ update, view: view({ isIndeterminate: true, isInvalid: true }) },
			Scene.given(init()),
			Scene.expect(control).toHaveAttr("data-indeterminate", "true"),
			Scene.expect(box).toHaveAttr("aria-invalid", "true"),
			Scene.expect(control).toHaveAttr("data-invalid", "true"),
		)
	})
})
