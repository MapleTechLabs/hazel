// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update, wiring } from "../test/kit-forms-fixtures"
import { ariaRadioGroup } from "./aria-radio"
import { radioGroup } from "./radio"

/** RadioGroup (styled) and the unstyled ariaRadioGroup: one selection per group, native arrow keys. */

const styledView =
	(isDisabled = false, isInvalid = false) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			radioGroup(
				h,
				{
					id: "plan",
					value: model.choice,
					onChange: (value) => Message.ChoseValue({ value }),
					isDisabled,
					isInvalid,
					interaction: wiring(model),
				},
				(parts) => [
					parts.label(["Plan"]),
					parts.description(["Billed monthly"]),
					parts.radio("free", "Free"),
					parts.radio("pro", "Pro"),
					parts.fieldError(["Pick a plan"]),
				],
			),
		])

const radio = (value: string) => Scene.selector(`#plan-${value}`)

describe("radio group scene", () => {
	test("renders a labelled, described radiogroup of native radios sharing one name", () => {
		Scene.scene(
			{ update, view: styledView() },
			Scene.given(init()),
			Scene.expect(Scene.role("radiogroup", { name: "Plan" })).toHaveAttr("aria-orientation", "vertical"),
			Scene.expect(Scene.role("radiogroup")).toHaveAccessibleDescription("Billed monthly"),
			Scene.expectAll(Scene.all.role("radio")).toHaveCount(2),
			Scene.expect(radio("free")).toHaveAttr("name", "plan"),
			Scene.expect(radio("free")).not.toBeChecked(),
			Scene.expect(Scene.text("Pick a plan")).toBeAbsent(),
		)
	})

	test("clicking a radio's label selects it and deselects the other", () => {
		Scene.scene(
			{ update, view: styledView() },
			Scene.given(init({ choice: "free" })),
			Scene.click(Scene.text("Pro")),
			Scene.expect(radio("pro")).toBeChecked(),
			Scene.expect(radio("free")).not.toBeChecked(),
		)
	})

	test("an arrow key's native change moves the selection", () => {
		Scene.scene(
			{ update, view: styledView() },
			Scene.given(init({ choice: "free" })),
			Scene.change(radio("pro"), "pro"),
			Scene.expect(radio("pro")).toBeChecked(),
		)
	})

	test("a disabled group is aria-disabled and its radios are disabled", () => {
		Scene.scene(
			{ update, view: styledView(true) },
			Scene.given(init()),
			Scene.expect(Scene.role("radiogroup")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(radio("free")).toBeDisabled(),
			Scene.expect(radio("pro")).toBeDisabled(),
		)
	})

	test("an invalid group shows its error and describes each radio with it", () => {
		Scene.scene(
			{ update, view: styledView(false, true) },
			Scene.given(init()),
			Scene.expect(Scene.role("radiogroup")).toHaveAttr("aria-invalid", "true"),
			Scene.expect(Scene.text("Pick a plan")).toExist(),
			Scene.expect(radio("pro")).toHaveAccessibleDescription("Billed monthly Pick a plan"),
		)
	})
})

const unstyledView =
	(isDisabled = false) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			ariaRadioGroup(
				h,
				{
					id: "size",
					ariaLabel: "Size",
					value: model.choice,
					onChange: (value) => Message.ChoseValue({ value }),
					isDisabled,
					interaction: wiring(model),
				},
				(radio) => [
					radio("s", { ariaLabel: "Small" }, (state) => [h.span([], [state.isSelected ? "S selected" : "S"])]),
					radio("m", { ariaLabel: "Medium", className: "medium-radio" }, (state) => [h.span([], [state.isHovered ? "M hovered" : "M"])]),
				],
			),
		])

describe("unstyled aria radio group scene", () => {
	test("an aria-labelled group uses the React Aria default classes", () => {
		Scene.scene(
			{ update, view: unstyledView() },
			Scene.given(init()),
			Scene.expect(Scene.role("radiogroup", { name: "Size" })).toHaveClass("react-aria-RadioGroup"),
			Scene.expect(Scene.role("radio", { name: "Small" })).not.toBeChecked(),
		)
	})

	test("clicking a radio selects it and its render prop sees the selection", () => {
		Scene.scene(
			{ update, view: unstyledView() },
			Scene.given(init()),
			Scene.click(Scene.text("S")),
			Scene.expect(Scene.role("radio", { name: "Small" })).toBeChecked(),
			Scene.expect(Scene.text("S selected")).toExist(),
		)
	})

	test("hovering a radio reaches its render prop", () => {
		Scene.scene(
			{ update, view: unstyledView() },
			Scene.given(init()),
			// mouseenter does not bubble, so hover the label itself.
			Scene.hover(Scene.selector("label.medium-radio")),
			Scene.expect(Scene.text("M hovered")).toExist(),
		)
	})

	test("a disabled unstyled group disables every radio and drops the click handlers", () => {
		Scene.scene(
			{ update, view: unstyledView(true) },
			Scene.given(init()),
			Scene.expect(Scene.role("radiogroup")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(Scene.role("radio", { name: "Medium" })).toBeDisabled(),
			Scene.expect(Scene.selector("label")).not.toHaveHandler("click"),
		)
	})
})

