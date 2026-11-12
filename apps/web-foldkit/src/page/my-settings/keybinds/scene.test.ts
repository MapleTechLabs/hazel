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

const REFUSED =
	"Hold Ctrl too: on its own, or with Alt or Shift, this key types, so it would fire while you type."

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

	test("a key on its own is refused, and recording goes on so a modifier can be added", () => {
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given(init().model),
			Scene.click(keyButton("Search Messages")),
			Scene.Subscription.emit(Message.PressedCombo({ combo: combo("J") })),
			Scene.expectNoOutMessage(),
			Scene.expect(Scene.text(REFUSED)).toExist(),
			Scene.expect(Scene.text("Press a shortcut")).toExist(),
			Scene.Subscription.emit(Message.PressedCombo({ combo: combo("Mod+J") })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedKeybindings({ overrides: { "search.open": combo("Mod+J") } }),
			),
		)
	})

	test("a refused key keeps its held modifiers on show, and cancelling clears the warning", () => {
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given(init().model),
			Scene.click(keyButton("Search Messages")),
			Scene.Subscription.emit(Message.PressedCombo({ combo: combo("Shift+K") })),
			Scene.expect(Scene.text("Now a key")).toExist(),
			Scene.expect(Scene.text(REFUSED)).toExist(),
			Scene.Subscription.emit(Message.CancelledRecording()),
			Scene.expect(Scene.text(REFUSED)).toBeAbsent(),
			Scene.expectNoOutMessage(),
		)
	})

	test("a key taken from an action and shared with a built-in says both", () => {
		const recording = update(
			init().model,
			Message.ClickedRecord({ actionId: "search.open" }),
			sharedWith({}),
		)
		const result = update(
			recording.model,
			Message.PressedCombo({ combo: combo("Mod+I") }),
			sharedWith({}),
		)
		expect(result.model.notice).toEqual({
			actionId: "search.open",
			tone: "warning",
			text: "Ctrl+I was removed from “Open Inbox”. It is also “Italic”, so it may not work there.",
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

	test("Reset takes the default key back, and says from where", () => {
		const moved = { "search.open": combo("Mod+I") }
		const result = update(
			init().model,
			Message.ClickedReset({ actionId: "inbox.open" }),
			sharedWith(moved),
		)
		expect(result.outMessage).toEqual(
			PageOutMessage.RequestedKeybindings({ overrides: { "search.open": null } }),
		)
		expect(result.model.notice).toEqual({
			actionId: "inbox.open",
			tone: "info",
			text: "Ctrl+I was removed from “Search Messages”.",
		})
	})

	test("a row whose default another override took can still be reset on its own", () => {
		// No override of its own: the default was dropped in resolve, as stored overrides can leave it.
		Scene.scene(
			pageScene(update, view, sharedWith({ "search.open": combo("Mod+I") })),
			Scene.given(init().model),
			Scene.expect(keyButton("Open Inbox")).toHaveAccessibleName(
				"Open Inbox: not set. Press to change.",
			),
			Scene.click(Scene.role("button", { name: "Reset to default (Ctrl+I)" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedKeybindings({ overrides: { "search.open": null } }),
			),
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

	test("finds keys by the names people type for them", () => {
		const macShared = makeShared({
			keybindingOverrides: {},
			keys: appKeymap.resolve({}, "mac"),
			keyboardPlatform: "mac",
		})
		Scene.scene(
			pageScene(update, view, macShared),
			Scene.given({ ...init().model, query: "cmd k" }),
			Scene.expect(keyButton("Open Command Palette")).toExist(),
			Scene.expect(keyButton("Open Inbox")).toBeAbsent(),
			// ⌘/: "k" starts "Keyboard", but a one-letter word only matches a key.
			Scene.expect(keyButton("Keyboard Shortcuts")).toBeAbsent(),
		)
		Scene.scene(
			pageScene(update, view, macShared),
			Scene.given({ ...init().model, query: "mod+i" }),
			Scene.expect(keyButton("Open Inbox")).toExist(),
			Scene.expect(keyButton("Open Command Palette")).toBeAbsent(),
		)
		Scene.scene(
			pageScene(update, view, sharedWith({})),
			Scene.given({ ...init().model, query: "esc" }),
			Scene.expect(keyButton("Mark Channel Read")).toExist(),
			Scene.expect(keyButton("Open Inbox")).toBeAbsent(),
		)
	})
})
