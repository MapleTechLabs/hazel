// @vitest-environment jsdom
import { Function } from "effect"
import * as Scene from "foldkit/scene"
import type { HtmlBuilder } from "foldkit/html"
import { describe, test } from "vitest"
import {
	CheckInputOtpPasswordBadge,
	init,
	inputOtp,
	Message,
	type Model,
	ReadSelection,
	SetSelection,
	update,
} from "./input-otp"

/** input-otp through the view: the labelled overlay input, slots, typing, backspace and disabled. */

const view = (model: Model, h: HtmlBuilder<Message>) =>
	inputOtp(h, { model, toParentMessage: Function.identity, ariaLabel: "Verification code" }, (parts) => [
		parts.group([parts.slot(0), parts.slot(1), parts.slot(2)]),
		parts.separator(),
		parts.group([parts.slot(3), parts.slot(4), parts.slot(5)]),
	])

const config = { update, view }
const input = Scene.role("textbox", { name: "Verification code" })
const slots = Scene.all.selector('[data-slot="input-otp-slot"]')
const slot = (index: number) => Scene.nth(slots, index)
const code = (value = "", isDisabled = false) =>
	init({ id: "otp-code", maxLength: 6, value, isDisabled }).model
const readSelection = (start: number, end: number) =>
	Scene.Command.resolve(ReadSelection, Message.ChangedSelection({ selection: { start, end } }))

describe("input-otp scene", () => {
	test("renders a labelled one-time-code input over six empty slots", () => {
		Scene.scene(
			config,
			Scene.given(code()),
			Scene.expect(input).toHaveAttr("autocomplete", "one-time-code"),
			Scene.expect(input).toHaveAttr("inputmode", "numeric"),
			Scene.expect(input).toHaveAttr("maxlength", "6"),
			Scene.expect(input).toHaveAttr("data-input-otp-placeholder-shown", "true"),
			Scene.expectAll(slots).toHaveCount(6),
			Scene.expectAll(Scene.all.selector('[data-slot="input-otp-group"]')).toHaveCount(2),
			Scene.expect(slot(0)).toBeEmpty(),
		)
	})

	test("typing digits fills the slots in order", () => {
		Scene.scene(
			config,
			Scene.given(code()),
			Scene.type(input, "12"),
			readSelection(2, 2),
			Scene.expect(input).toHaveValue("12"),
			Scene.expect(slot(0)).toHaveText("1"),
			Scene.expect(slot(1)).toHaveText("2"),
			Scene.expect(slot(2)).toBeEmpty(),
			Scene.expect(input).not.toHaveAttr("data-input-otp-placeholder-shown"),
		)
	})

	test("pasting a longer code fills every slot and drops the rest", () => {
		Scene.scene(
			config,
			Scene.given(code()),
			Scene.type(input, "98765432"),
			readSelection(6, 6),
			Scene.expect(input).toHaveValue("987654"),
			Scene.expect(slot(5)).toHaveText("4"),
		)
	})

	test("backspace empties the last filled slot", () => {
		Scene.scene(
			config,
			Scene.given(code("123")),
			Scene.type(input, "12"),
			readSelection(2, 2),
			Scene.expect(slot(1)).toHaveText("2"),
			Scene.expect(slot(2)).toBeEmpty(),
		)
	})

	test("focusing the input marks the next empty slot active with a caret", () => {
		Scene.scene(
			config,
			Scene.given(code("12")),
			Scene.focus(input),
			Scene.Command.resolveAll(
				[SetSelection, Message.CompletedSetSelection()],
				[ReadSelection, Message.ChangedSelection({ selection: { start: 2, end: 2 } })],
				[CheckInputOtpPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckInputOtpPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
				[CheckInputOtpPasswordBadge, Message.CompletedCheckPasswordBadge({ hasBadge: false })],
			),
			Scene.expect(slot(2)).toHaveAttr("data-active", "true"),
			Scene.expect(slot(1)).toHaveAttr("data-active", "false"),
			Scene.expect(input).toHaveAttr("data-input-otp-mss", "2"),
			Scene.expect(input).toHaveAttr("data-input-otp-mse", "2"),
		)
	})

	test("a disabled code shows its digits in a disabled input", () => {
		Scene.scene(
			config,
			Scene.given(code("1234", true)),
			Scene.expect(input).toBeDisabled(),
			Scene.expect(input).toHaveValue("1234"),
			Scene.expect(slot(3)).toHaveText("4"),
			Scene.expect(slot(0)).toHaveAttr("data-active", "false"),
		)
	})
})
