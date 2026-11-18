// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { combo } from "~/lib/keybindings/key-combo"
import { collectKeyStream } from "../../../test/key-stream"
import { layoutHotkeys, layoutKeysOf } from "../../../overlay/hotkeys"
import { Message } from "./message"
import { recorderStream } from "./subscription"
import { Effect, Fiber, Stream } from "effect"

/** The recorder from real `keydown`s: it takes every press before the app's own hotkeys see it. */

const ctrl = (init: KeyboardEventInit): KeyboardEventInit => ({ ...init, ctrlKey: true })

describe("recorder", () => {
	test("a modifier alone shows as held; the key lands as a Mod combo", async () => {
		const recorded = await collectKeyStream(recorderStream("linux"), (press) => {
			press({ key: "Control", ctrlKey: true })
			press(ctrl({ key: "j" }))
		})
		expect(recorded).toEqual([
			Message.ChangedHeldModifiers({ modifiers: ["Mod"] }),
			Message.PressedCombo({ combo: combo("Mod+J") }),
		])
	})

	test("Escape alone cancels; Shift+Escape is a key like any other", async () => {
		const recorded = await collectKeyStream(recorderStream("linux"), (press) => {
			press({ key: "Escape" })
			press({ key: "Escape", shiftKey: true })
		})
		expect(recorded).toEqual([
			Message.CancelledRecording(),
			Message.PressedCombo({ combo: combo("Shift+Escape") }),
		])
	})

	test("while recording, the app's hotkeys never see the press", async () => {
		const fromHotkeys: Array<string> = []
		const hotkeys = Effect.runFork(
			Stream.runForEach(
				layoutHotkeys((id) => id, layoutKeysOf(appKeymap.defaults)),
				(id) => Effect.sync(() => fromHotkeys.push(id)),
			),
		)
		const recorded = await collectKeyStream(recorderStream("linux"), (press) => {
			const event = press(ctrl({ key: "k" }))
			expect(event.defaultPrevented).toBe(true)
		})
		await Effect.runPromise(Fiber.interrupt(hotkeys))
		expect(recorded).toEqual([Message.PressedCombo({ combo: combo("Mod+K") })])
		expect(fromHotkeys).toEqual([])
	})
})
