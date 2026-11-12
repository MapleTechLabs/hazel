// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { combo } from "~/lib/keybindings/key-combo"
import type { Overrides } from "~/lib/keybindings/keymap"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { init, update } from "./update"
import { view } from "./view"

/** The Keybinds page: press a row's key button, press keys, and the root stores the new key. */

const sharedWith = (overrides: Overrides) =>
	makeShared({
		keybindingOverrides: overrides,
		keys: appKeymap.resolve(overrides, "linux"),
		keyboardPlatform: "linux",
	})

const keyButton = (label: string) => Scene.role("button", { name: new RegExp(`^${label}:`) })

describe("recording a key", () => {
	test("pressing a row's key button records the next combo and asks the root to store it", () => {
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given(init().model),
			Scene.expect(keyButton("Open Inbox")).toHaveAccessibleName(
				"Open Inbox: Ctrl+I. Press to change.",
			),
			Scene.click(keyButton("Open Inbox")),
			Scene.expect(Scene.text("Press a shortcut")).toExist(),
			Scene.Subscription.emit(Message.ChangedHeldModifiers({ modifiers: ["Mod"] })),
			Scene.expect(Scene.text("Now a key")).toExist(),
			Scene.Subscription.emit(Message.PressedCombo({ combo: combo("Mod+J") })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedKeybindings({ overrides: { "inbox.open": combo("Mod+J") } }),
			),
			Scene.expect(Scene.text("Press a shortcut")).toBeAbsent(),
		)
	})

	test("a key another action had moves, and the row says where it came from", () => {
		const result = update(
			update(init().model, Message.ClickedRecord({ actionId: "inbox.open" }), sharedWith({})).model,
			Message.PressedCombo({ combo: combo("Mod+K") }),
			sharedWith({}),
		)
		expect(result.outMessage).toEqual(
			PageOutMessage.RequestedKeybindings({
				overrides: { "inbox.open": combo("Mod+K"), "commandPalette.open": null },
			}),
		)
		expect(result.model.notice).toEqual({
			actionId: "inbox.open",
			tone: "info",
			text: "Ctrl+K was removed from “Open Command Palette”.",
		})
	})

	test("a key a built-in shortcut uses is allowed, with a warning", () => {
		const recording = update(
			init().model,
			Message.ClickedRecord({ actionId: "channel.pins" }),
			sharedWith({}),
		)
		const result = update(
			recording.model,
			Message.PressedCombo({ combo: combo("Mod+B") }),
			sharedWith({}),
		)
		expect(result.model.notice).toMatchObject({
			tone: "warning",
			text: expect.stringContaining("“Bold”"),
		})
	})

	test("Escape (or a click elsewhere) cancels without saving", () => {
		const recording = update(
			init().model,
			Message.ClickedRecord({ actionId: "inbox.open" }),
			sharedWith({}),
		)
		const cancelled = update(recording.model, Message.CancelledRecording(), sharedWith({}))
		expect(cancelled.model.recording).toBeNull()
		expect(cancelled.outMessage).toBeUndefined()
	})

	test("a built-in shortcut cannot be recorded", () => {
		expect(
			update(init().model, Message.ClickedRecord({ actionId: "composer.bold" }), sharedWith({})).model
				.recording,
		).toBeNull()
	})
})

describe("reset and remove", () => {
	const custom = sharedWith({ "inbox.open": combo("Mod+J") })

	test("a changed row shows Custom and resets to its default", () => {
		Scene.scene(
			pageScene(update, view, custom),
			Scene.given(init().model),
			Scene.expect(Scene.text("1 customized")).toExist(),
			Scene.click(Scene.role("button", { name: "Reset to default (Ctrl+I)" })),
			Scene.expectOutMessage(PageOutMessage.RequestedKeybindings({ overrides: {} })),
		)
	})

	test("Remove keybind leaves the action unbound", () => {
		expect(
			update(init().model, Message.ClickedUnbind({ actionId: "channel.pins" }), sharedWith({}))
				.outMessage,
		).toEqual(PageOutMessage.RequestedKeybindings({ overrides: { "channel.pins": null } }))
	})

	test("Reset all clears every override", () => {
		Scene.scene(
			pageScene(update, view, custom),
			Scene.given(init().model),
			Scene.click(Scene.role("button", { name: "Reset all" })),
			Scene.expectOutMessage(PageOutMessage.RequestedKeybindings({ overrides: {} })),
		)
	})

	test("with nothing changed, Reset all is disabled", () => {
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given(init().model),
			Scene.expect(Scene.role("button", { name: "Reset all" })).toBeDisabled(),
		)
	})
})

describe("search", () => {
	test("filters by name and by key", () => {
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given({ ...init().model, query: "inbox" }),
			Scene.expect(keyButton("Open Inbox")).toExist(),
			Scene.expect(keyButton("Open Command Palette")).toBeAbsent(),
		)
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given({ ...init().model, query: "ctrl+k" }),
			Scene.expect(keyButton("Open Command Palette")).toExist(),
			Scene.expect(keyButton("Open Inbox")).toBeAbsent(),
		)
	})
})
