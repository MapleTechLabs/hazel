// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { CheckAutostart, init, SetAutostart, update } from "./update"
import { view } from "./view"

/** The desktop page through its view: the launch-at-login switch waits for the real autostart state. */

const shared = makeShared()
const openAtLogin = Scene.label("Open at login")

describe("launch at startup", () => {
	test("init asks for the current autostart state", () => {
		expect(init().commands?.map((command) => command.name)).toEqual([CheckAutostart.name])
	})

	test("the switch is disabled until the state is known, then reflects it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init().model),
			Scene.expect(openAtLogin).toBeDisabled(),
			// The result of init's CheckAutostart, fed through update.
			Scene.Subscription.emit(Message.CheckedAutostart({ isEnabled: true })),
			Scene.expect(openAtLogin).toBeEnabled(),
			Scene.expect(openAtLogin).toBeChecked(),
		)
	})

	test("turning it on writes the setting and checks the switch once it succeeds", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ ...init().model, autostartEnabled: false }),
			Scene.click(openAtLogin),
			Scene.Command.expectExact(SetAutostart({ isEnabled: true })),
			Scene.expect(openAtLogin).not.toBeChecked(),
			Scene.Command.resolve(SetAutostart, Message.SucceededSetAutostart({ isEnabled: true })),
			Scene.expect(openAtLogin).toBeChecked(),
		)
	})

	test("a second toggle while a write runs is ignored, and a late initial read cannot undo the write", () => {
		const writing = update(
			{ ...init().model, autostartEnabled: false },
			Message.ToggledAutostart({ isSelected: true }),
		)
		expect(writing.model.isUpdating).toBe(true)
		expect(update(writing.model, Message.ToggledAutostart({ isSelected: false })).commands ?? []).toEqual(
			[],
		)
		const written = update(writing.model, Message.SucceededSetAutostart({ isEnabled: true })).model
		expect(written).toMatchObject({ autostartEnabled: true, isUpdating: false })
		expect(update(written, Message.CheckedAutostart({ isEnabled: false })).model.autostartEnabled).toBe(
			true,
		)
	})

	test("a failed write toasts and falls back to the re-read state", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given({ ...init().model, autostartEnabled: false }),
			Scene.click(openAtLogin),
			Scene.Command.resolve(
				SetAutostart,
				Message.FailedSetAutostart({ reason: "PluginFailed", isEnabled: false }),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to update launch at login",
						description: "Please try again.",
					},
				}),
			),
			Scene.expect(openAtLogin).not.toBeChecked(),
			Scene.expect(openAtLogin).toBeEnabled(),
		)
	})
})
