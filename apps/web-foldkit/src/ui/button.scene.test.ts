// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import { init, Message, type Model, page, update, wiring } from "../test/kit-forms-fixtures"
import * as Interaction from "./aria/interaction"
import { type AriaButtonOptions, button } from "./button"

/** Button: React Aria press, hover and focus state, disabled and pending behavior. */

const view =
	(options: Partial<AriaButtonOptions<Message>> = {}) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		page(h, [
			button(
				h,
				{
					onPress: Message.ClickedButton(),
					interaction: { wiring: wiring(model), target: "save" },
					...options,
				},
				[`Save (${model.pressCount})`],
			),
		])

const save = (count: number) => Scene.role("button", { name: `Save (${count})` })

describe("button scene", () => {
	test("clicking an enabled button sends its press Message", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.expect(save(0)).toHaveAttr("type", "button"),
			Scene.click(save(0)),
			Scene.expect(save(1)).toExist(),
		)
	})

	test("a pointer press marks the button pressed until pointerup", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.pointerDown(save(0)),
			Scene.expect(save(0)).toHaveAttr("data-pressed", "true"),
			// usePress ends a pointer press on a document pointerup, which the Submodel subscribes to.
			Scene.Subscription.emit(Message.GotInteractionMessage({ message: Interaction.Message.ReleasedPointer() })),
			Scene.expect(save(0)).not.toHaveAttr("data-pressed"),
		)
	})

	test("Enter shows the pressed state and focus shows the focus ring", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(init()),
			Scene.focus(save(0)),
			Scene.keydown(save(0), "Enter"),
			Scene.expect(save(0)).toHaveAttr("data-pressed", "true"),
			Scene.expect(save(0)).toHaveAttr("data-focus-visible", "true"),
		)
	})

	test("a disabled button is disabled with no press handler", () => {
		Scene.scene(
			{ update, view: view({ isDisabled: true }) },
			Scene.given(init()),
			Scene.expect(save(0)).toBeDisabled(),
			Scene.expect(save(0)).toHaveAttr("data-disabled", "true"),
			Scene.expect(save(0)).not.toHaveHandler("click"),
			Scene.expect(save(0)).not.toHaveHandler("pointerdown"),
		)
	})

	test("a pending button is aria-disabled, ignores presses, but still takes focus", () => {
		Scene.scene(
			{ update, view: view({ isPending: true }) },
			Scene.given(init()),
			Scene.expect(save(0)).toHaveAttr("aria-disabled", "true"),
			Scene.expect(save(0)).toHaveAttr("data-pending", "true"),
			Scene.expect(save(0)).not.toHaveAttr("disabled"),
			Scene.expect(save(0)).not.toHaveHandler("click"),
			Scene.focus(save(0)),
			Scene.expect(save(0)).toHaveAttr("data-focused", "true"),
		)
	})

	test("preventFocusOnPress keeps focus from being reported", () => {
		Scene.scene(
			{ update, view: view({ preventFocusOnPress: true }) },
			Scene.given(init()),
			Scene.expect(save(0)).not.toHaveHandler("focus"),
			Scene.expect(save(0)).toHaveHandler("click"),
		)
	})
})
