// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { collectKeyStream } from "../test/key-stream"
import { globalTypingStream } from "./window-events"

/** Typing anywhere goes to the composer (Discord, Slack), but never steals keys from a field or a shortcut. */

const run = (act: Parameters<typeof collectKeyStream>[1]) =>
	collectKeyStream(
		globalTypingStream((key) => key),
		act,
	)

describe("typing outside the composer", () => {
	test("a printable key typed on the page is taken over for the composer", async () => {
		const prevented: Array<boolean> = []
		const keys = await run((press) => {
			prevented.push(press({ key: "h" }).defaultPrevented)
			prevented.push(press({ key: "?" }).defaultPrevented)
		})
		expect(keys).toEqual(["h", "?"])
		expect(prevented).toEqual([true, true])
	})

	test.each([
		["an input", () => document.createElement("input")],
		["a textarea", () => document.createElement("textarea")],
		["an editable", () => Object.assign(document.createElement("div"), { contentEditable: "true" })],
	])("keys typed in %s stay there", async (_name, make) => {
		const field = make()
		document.body.append(field)
		const keys = await run((press) => press({ key: "h" }, field))
		field.remove()
		expect(keys).toEqual([])
	})

	test.each([
		["Mod", { metaKey: true }],
		["Control", { ctrlKey: true }],
		["Alt", { altKey: true }],
	])("%s+key is a shortcut, not typing", async (_name, modifiers) => {
		expect(await run((press) => press({ key: "c", ...modifiers }))).toEqual([])
	})

	test.each(["Enter", "Escape", "ArrowUp", "Tab", "PageDown", "Shift"])("%s is not typing", async (key) => {
		expect(await run((press) => press({ key }))).toEqual([])
	})
})
