// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update, wiring } from "../test/kit-forms-fixtures"
import { checkbox, checkboxGroup, type CheckboxOptions } from "./checkbox"

/** Checkbox through a parent that owns the value and the interaction Submodel. */

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
					interaction: wiring(model),
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

	test("hovering and pressing the label shows hover and pressed state", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.hover(control),
			Scene.expect(control).toHaveAttr("data-hovered", "true"),
			Scene.pointerDown(control),
			Scene.expect(control).toHaveAttr("data-pressed", "true"),
			Scene.expect(control).toHaveAttr("style", "user-select: none;"),
		)
	})

	test("focusing the input without a pointer press shows the focus ring on the control", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.focus(box),
			Scene.expect(control).toHaveAttr("data-focused", "true"),
			Scene.expect(control).toHaveAttr("data-focus-visible", "true"),
		)
	})

	test("a disabled checkbox is disabled and ignores hover", () => {
		Scene.scene(
			{ update, view: view({ isDisabled: true }) },
			Scene.given(init()),
			Scene.expect(box).toBeDisabled(),
			Scene.expect(control).toHaveAttr("data-disabled", "true"),
			Scene.expect(control).not.toHaveHandler("click"),
			Scene.expect(control).not.toHaveHandler("mouseenter"),
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

	test("a checkbox group is a labelled group whose items follow the group value", () => {
		const groupView = (model: Model, h: HtmlBuilder<Message>) =>
			page(h, [
				checkboxGroup(
					h,
					{
						id: "channels",
						value: model.isSelected ? ["email"] : [],
						onChange: (value) => Message.ChangedSelection({ isSelected: value.includes("email") }),
						interaction: wiring(model),
					},
					(parts) => [parts.label(["Channels"]), parts.checkbox("email", "Email"), parts.checkbox("sms", "SMS")],
				),
			])
		Scene.scene(
			{ update, view: groupView },
			Scene.given(init()),
			Scene.expect(Scene.role("group", { name: "Channels" })).toExist(),
			Scene.click(Scene.text("Email")),
			Scene.expect(Scene.selector("#channels-email")).toBeChecked(),
			Scene.expect(Scene.selector("#channels-email")).toHaveAttr("value", "email"),
			Scene.expect(Scene.selector("#channels-sms")).not.toBeChecked(),
		)
	})
})
