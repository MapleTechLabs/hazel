// @vitest-environment jsdom
import { Effect, Fiber, Stream } from "effect"
import { describe, expect, test } from "vitest"
import { collectKeyStream } from "../test/key-stream"
import { type GlobalPaste, globalPasteStream, globalTypingStream } from "./window-events"

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

	test("a key a focused message already took (E to edit) is not typed into the composer", async () => {
		const row = document.createElement("div")
		row.tabIndex = -1
		row.addEventListener("keydown", (event) => event.preventDefault())
		document.body.append(row)
		const keys = await run((press) => press({ key: "e" }, row))
		row.remove()
		expect(keys).toEqual([])
	})

	test.each(["Enter", "Escape", "ArrowUp", "Tab", "PageDown", "Shift"])("%s is not typing", async (key) => {
		expect(await run((press) => press({ key }))).toEqual([])
	})
})

/** Pasting anywhere goes to the composer too: the editor need not have the caret first. */

const pasteEvent = (text: string, files: ReadonlyArray<File> = []) =>
	Object.assign(new Event("paste", { bubbles: true, cancelable: true }), {
		clipboardData: {
			files,
			items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
			getData: (format: string) => (format === "text/plain" ? text : ""),
		},
	})

const collectPastes = async (act: (paste: (event: Event, target?: EventTarget) => Event) => void) => {
	const emitted: Array<GlobalPaste> = []
	const fiber = Effect.runFork(
		Stream.runForEach(
			globalPasteStream((paste) => paste),
			(paste) => Effect.sync(() => emitted.push(paste)),
		),
	)
	await new Promise((resolve) => setTimeout(resolve, 0))
	act((event, target = document.body) => {
		target.dispatchEvent(event)
		return event
	})
	await new Promise((resolve) => setTimeout(resolve, 0))
	await Effect.runPromise(Fiber.interrupt(fiber))
	return emitted
}

describe("pasting outside the composer", () => {
	const png = new File(["x"], "shot.png", { type: "image/png" })

	test("a file pasted on the page goes to the composer, and the browser does nothing with it", async () => {
		const prevented: Array<boolean> = []
		const pastes = await collectPastes((paste) => {
			prevented.push(paste(pasteEvent("", [png])).defaultPrevented)
		})
		expect(pastes).toEqual([{ _tag: "Files", files: [png] }])
		expect(prevented).toEqual([true])
	})

	test("text pasted on the page goes to the composer", async () => {
		expect(await collectPastes((paste) => paste(pasteEvent("hello\nworld")))).toEqual([
			{ _tag: "Text", text: "hello\nworld" },
		])
	})

	test("a file type a message cannot carry, or an empty clipboard, is left alone", async () => {
		const binary = new File(["x"], "tool.exe", { type: "application/x-msdownload" })
		expect(await collectPastes((paste) => paste(pasteEvent("", [binary])))).toEqual([])
		expect(await collectPastes((paste) => paste(pasteEvent("")))).toEqual([])
	})

	test.each([
		["an input", () => document.createElement("input")],
		["an editable", () => Object.assign(document.createElement("div"), { contentEditable: "true" })],
	])("a paste into %s stays there", async (_name, make) => {
		const field = make()
		document.body.append(field)
		const pastes = await collectPastes((paste) => paste(pasteEvent("hi", [png]), field))
		field.remove()
		expect(pastes).toEqual([])
	})
})
