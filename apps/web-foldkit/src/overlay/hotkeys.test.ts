// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { collectKeyStream } from "../test/key-stream"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { combo } from "~/lib/keybindings/key-combo"
import type { Overrides } from "~/lib/keybindings/keymap"
import { layoutHotkeys, layoutKeysOf } from "./hotkeys"

/** The org layout's hotkeys from real `keydown`s: Mod is Meta on a Mac, Control elsewhere. */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (init: KeyboardEventInit): KeyboardEventInit =>
	isMac ? { ...init, metaKey: true } : { ...init, ctrlKey: true }
const run = (
	act: Parameters<typeof collectKeyStream>[1],
	isChannelNavigationEnabled = true,
	isOverlayOpen = false,
) =>
	collectKeyStream(
		layoutHotkeys((id) => id, layoutKeysOf(appKeymap.defaults), {
			isChannelNavigationEnabled,
			isOverlayOpen,
		}),
		act,
	)

// jsdom has no `isContentEditable`, which the bindings read to tell typing apart (browsers have it).
if (!("isContentEditable" in HTMLElement.prototype))
	Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
		get(this: HTMLElement) {
			return this.getAttribute("contenteditable") === "true"
		},
	})

/** The composer: a contenteditable, like ProseMirror's. */
const composer = () => {
	const editable = document.createElement("div")
	editable.setAttribute("contenteditable", "true")
	document.body.append(editable)
	return editable
}

describe("layout hotkeys", () => {
	test.each([
		[{ key: "k" }, "commandPalette.open"],
		[{ key: "F", shiftKey: true }, "search.open"],
		[{ key: "n", altKey: true, code: "KeyN" }, "channel.create"],
		[{ key: "d", altKey: true, code: "KeyD" }, "dm.create"],
		[{ key: "i", altKey: true, code: "KeyI" }, "invite.email"],
		[{ key: "/" }, "shortcuts.open"],
		[{ key: "D", shiftKey: true }, "sidebar.toggle"],
		[{ key: "[" }, "history.back"],
		[{ key: "]" }, "history.forward"],
		[{ key: "ArrowUp", altKey: true }, "organization.previous"],
		[{ key: "ArrowDown", altKey: true }, "organization.next"],
		[{ key: "ArrowUp", altKey: true, shiftKey: true }, "mention.previous"],
		[{ key: "ArrowDown", altKey: true, shiftKey: true }, "mention.next"],
	] as const)("Mod+%j fires %s and takes the key from the browser", async (init, actionId) => {
		const prevented: Array<boolean> = []
		const fired = await run((press) => prevented.push(press(mod(init)).defaultPrevented))
		expect(fired).toEqual([actionId])
		expect(prevented).toEqual([true])
	})

	test("the hotkeys fire while typing in the composer", async () => {
		const editable = composer()
		const fired = await run((press) => {
			press(mod({ key: "k" }), editable)
			press(mod({ key: "/" }), editable)
			press(mod({ key: "D", shiftKey: true }), editable)
		})
		editable.remove()
		expect(fired).toEqual(["commandPalette.open", "shortcuts.open", "sidebar.toggle"])
	})

	test("the plain letters do nothing", async () => {
		expect(await run((press) => press({ key: "k" }))).toEqual([])
	})

	test("Alt+ArrowUp / Alt+ArrowDown go to the previous / next channel, from the composer too", async () => {
		const editable = composer()
		const fired = await run((press) => {
			press({ key: "ArrowUp", altKey: true })
			press({ key: "ArrowDown", altKey: true }, editable)
		})
		editable.remove()
		expect(fired).toEqual(["channel.previous", "channel.next"])
	})

	test("Alt+Shift+ArrowUp / Alt+Shift+ArrowDown go to the previous / next unread channel", async () => {
		const fired = await run((press) => {
			press({ key: "ArrowUp", altKey: true, shiftKey: true })
			press({ key: "ArrowDown", altKey: true, shiftKey: true })
		})
		expect(fired).toEqual(["channel.previousUnread", "channel.nextUnread"])
	})

	test("off chat pages Alt+ArrowUp keeps moving the caret in fields", async () => {
		const editable = composer()
		const prevented: Array<boolean> = []
		const fired = await run(
			(press) => prevented.push(press({ key: "ArrowUp", altKey: true }, editable).defaultPrevented),
			false,
		)
		editable.remove()
		expect(fired).toEqual([])
		expect(prevented).toEqual([false])
	})

	test("Shift+Escape marks everything read, from the composer too", async () => {
		const editable = composer()
		const fired = await run((press) => press({ key: "Escape", shiftKey: true }, editable))
		editable.remove()
		expect(fired).toEqual(["organization.markRead"])
	})

	test("Mod+I is italic while typing and the inbox elsewhere", async () => {
		const editable = composer()
		const fired = await run((press) => {
			press(mod({ key: "i" }), editable)
			press(mod({ key: "i" }))
		})
		editable.remove()
		expect(fired).toEqual(["inbox.open"])
	})

	test("behind a modal or the palette the app-wide actions stay off; the palette's own key does not", async () => {
		const prevented: Array<boolean> = []
		const fired = await run(
			(press) => {
				prevented.push(press({ key: "Escape", shiftKey: true }).defaultPrevented)
				press(mod({ key: "/" }))
				press(mod({ key: "[" }))
				press(mod({ key: "D", shiftKey: true }))
				press(mod({ key: "i" }))
				press({ key: "ArrowDown", altKey: true })
				press(mod({ key: "k" }))
			},
			false,
			true,
		)
		expect(fired).toEqual(["commandPalette.open"])
		// Escape is left to the dialog, which closes on it.
		expect(prevented).toEqual([false])
	})

	test("Mod+B stays the composer's bold", async () => {
		const editable = composer()
		expect(await run((press) => press(mod({ key: "b" }), editable))).toEqual([])
		editable.remove()
	})
})

describe("rebound layout hotkeys", () => {
	const rebound = (overrides: Overrides) =>
		layoutKeysOf(appKeymap.resolve(overrides, isMac ? "mac" : "linux"))
	const runWith = (overrides: Overrides, act: Parameters<typeof collectKeyStream>[1]) =>
		collectKeyStream(
			layoutHotkeys((id) => id, rebound(overrides)),
			act,
		)

	test("an action fires on its new key, and no longer on its old one", async () => {
		const fired = await runWith({ "inbox.open": combo("Mod+J") }, (press) => {
			press(mod({ key: "j" }))
			press(mod({ key: "i" }))
		})
		expect(fired).toEqual(["inbox.open"])
	})

	test("an action that lost its key to another, or was unbound, does not fire", async () => {
		const fired = await runWith(
			{ "search.open": combo("Mod+K"), "commandPalette.open": null, "shortcuts.open": null },
			(press) => {
				press(mod({ key: "k" }))
				press(mod({ key: "/" }))
			},
		)
		expect(fired).toEqual(["search.open"])
	})
})
