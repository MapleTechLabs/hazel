/**
 * Lane A2 (W12b): the composer typed for real in Chromium (native Backspace, triggers, paste, drop).
 * Runs in Vitest's browser mode only; `vitest run` under Node skips it (see the integrator's report).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Plain, Primitive } from "../../../define.ts"

const inBrowser = typeof navigator !== "undefined" && /Chrome|HeadlessChrome/.test(navigator.userAgent)

type Keyboard = (text: string) => Promise<void>
let keyboard: Keyboard
let Composer: typeof import("../../composer.ts")
let markdownOf: (input: HTMLElement) => string

beforeAll(async () => {
	if (!inBrowser) return
	// Imported here: `vitest/browser` only loads in browser mode.
	keyboard = (await import("vitest/browser")).userEvent.keyboard
	Composer = await import("../../composer.ts")
	const { editorOf } = await import("../editor.ts")
	const { toMarkdown } = await import("../markdown.ts")
	markdownOf = (input) => toMarkdown(editorOf(input)!.state.doc)
})

afterEach(() => {
	if (inBrowser) document.body.replaceChildren()
})

const mod = () => (/Mac/.test(navigator.platform) ? "Meta" : "Control")

const mount = (props: Readonly<Record<string, Plain>>, on: ReadonlyArray<string>) => {
	const made: Primitive = Composer.primitive.create({
		document,
		tag: "hz:composer",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "composer"
			return node
		},
		self: (node, set) => ({ tag: "hz:composer", outer: node, content: node, set, events: undefined }),
	})
	const fired: Array<readonly [string, Record<string, unknown>]> = []
	made.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload as Record<string, unknown>])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) made.set(name, value)
	document.body.append(made.outer)
	const input = made.outer.querySelector<HTMLElement>("[data-hz-part=input]")!
	input.focus()
	const last = (event: string) => fired.filter(([name]) => name === event).at(-1)?.[1]
	const all = (event: string) => fired.filter(([name]) => name === event).map(([, payload]) => payload)
	return { node: made.outer, input, set: made.set, fired, last, all, markdown: () => markdownOf(input) }
}

const transfer = (files: ReadonlyArray<File>, text?: string) => {
	const data = new DataTransfer()
	for (const file of files) data.items.add(file)
	if (text !== undefined) data.setData("text/plain", text)
	return data
}
const png = () => new File(["png"], "shot.png", { type: "image/png" })

describe.runIf(inBrowser)("composer in a real browser", () => {
	it("keeps markdown in the text, highlighted, and Mod+B wraps the selection", async () => {
		const composer = mount({}, ["change"])
		await keyboard("so **bold** _it_ ~~gone~~ `x`")
		const leaves = [...composer.input.querySelectorAll<HTMLElement>("[data-hz-md]")]
			.filter((leaf) => leaf.dataset.hzMd !== "marker")
			.map((leaf) => `${leaf.dataset.hzMd}:${leaf.textContent}`)
		expect(leaves).toEqual(["bold:bold", "italic:it", "strikethrough:gone", "code:x"])
		expect(composer.last("change")).toMatchObject({ value: "so **bold** _it_ ~~gone~~ `x`" })
		await keyboard(" word{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}")
		await keyboard(`{${mod()}>}b{/${mod()}}`)
		expect(composer.markdown()).toBe("so **bold** _it_ ~~gone~~ `x` **word**")
	})

	it("deletes one character at a time with the browser's own Backspace", async () => {
		const composer = mount({}, ["change"])
		await keyboard("hello{Backspace}")
		expect(composer.last("change")).toMatchObject({ value: "hell" })
		await keyboard("{Enter}")
		expect(composer.markdown()).toBe("hell")
		await keyboard("{Shift>}{Enter}{/Shift}there")
		expect(composer.markdown()).toBe("hell\nthere")
	})

	it("opens each trigger at the caret: @, #, : after a space, / at a line start", async () => {
		const composer = mount({}, ["trigger", "change"])
		await keyboard("hi @ma")
		expect(composer.last("trigger")).toEqual({ kind: "@", query: "ma" })
		await keyboard(" #ge")
		expect(composer.all("trigger").slice(-4)).toEqual([
			{ kind: "@", query: null },
			{ kind: "#", query: "" },
			{ kind: "#", query: "g" },
			{ kind: "#", query: "ge" },
		])
		await keyboard(" :ta")
		expect(composer.last("trigger")).toEqual({ kind: ":", query: "ta" })
		await keyboard(" /gif")
		expect(composer.last("trigger")).toEqual({ kind: ":", query: null })
		await keyboard("{Shift>}{Enter}{/Shift}/gi")
		expect(composer.last("trigger")).toEqual({ kind: "/", query: "gi" })
		await keyboard("{Backspace}{Backspace}{Backspace}")
		expect(composer.last("trigger")).toEqual({ kind: "/", query: null })
		await keyboard("mail@x")
		expect(composer.last("trigger")).toEqual({ kind: "/", query: null })
	})

	it("inserts a mention atom from a pressed suggestion, keeps typing after it, deletes it in one step", async () => {
		const composer = mount({}, ["trigger", "change", "key", "submit"])
		await keyboard("Thanks @ma")
		composer.set("suggestions", [
			{ id: "u1", label: "Maya Chen", face: { name: "Maya Chen", initials: "MC" } },
			{ id: "u2", label: "Leo Park", face: { name: "Leo Park", initials: "LP" } },
		])
		await keyboard("{ArrowDown}{Enter}")
		expect(composer.all("key")).toEqual([{ key: "down" }, { key: "enter" }])
		expect(composer.all("submit")).toEqual([])
		// The screen answers with the trigger text replaced: a Model edit over the field's revision.
		const { rev } = composer.last("change") as { rev: number }
		composer.set("suggestions", [])
		composer.set("value", { text: "Thanks @[userId:u1] ", rev, edit: 1 })
		const mention = composer.input.querySelector<HTMLElement>("[data-hz-part=mention]")!
		expect(mention.textContent).toBe("@Maya Chen")
		expect(composer.last("trigger")).toEqual({ kind: "@", query: null })
		await keyboard("hi")
		expect(composer.last("change")).toMatchObject({ value: "Thanks @[userId:u1] hi", edit: 1 })
		await keyboard("{Backspace}{Backspace}{Backspace}{Backspace}")
		expect(composer.markdown()).toBe("Thanks ")
		expect(composer.input.querySelector("[data-hz-part=mention]")).toBeNull()
	})

	it("inserts a custom emoji atom from the : trigger", async () => {
		const url = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E"
		const composer = mount({}, ["trigger", "change"])
		await keyboard("Ship it :tan")
		expect(composer.last("trigger")).toEqual({ kind: ":", query: "tan" })
		const { rev } = composer.last("change") as { rev: number }
		composer.set("value", { text: `Ship it ![custom-emoji:tanuki](${url})`, rev, edit: 1 })
		const emoji = composer.input.querySelector<HTMLImageElement>("img[data-hz-part=customEmoji]")!
		expect(emoji.alt).toBe(":tanuki:")
		await keyboard("!")
		expect(composer.markdown()).toBe(`Ship it ![custom-emoji:tanuki](${url})!`)
		await keyboard("{Backspace}{Backspace}")
		expect(composer.markdown()).toBe("Ship it ")
	})

	it("pastes text as plain lines, and pasted files as files", () => {
		const composer = mount({}, ["change", "files"])
		composer.input.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: transfer([], "one **two**\nthree"),
				bubbles: true,
				cancelable: true,
			}),
		)
		expect(composer.markdown()).toBe("one **two**\nthree")
		const paste = new ClipboardEvent("paste", {
			clipboardData: transfer([png()], "shot.png"),
			bubbles: true,
			cancelable: true,
		})
		composer.input.dispatchEvent(paste)
		expect(paste.defaultPrevented).toBe(true)
		expect(composer.last("files")).toEqual({ count: 1 })
		expect(composer.markdown()).toBe("one **two**\nthree")
		expect(Composer.takeDropped().map((file) => file.name)).toEqual(["shot.png"])
		// A type a message cannot carry pastes nothing as a file.
		composer.input.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: transfer([new File(["z"], "a.zip", { type: "application/zip" })]),
				bubbles: true,
				cancelable: true,
			}),
		)
		expect(composer.all("files")).toHaveLength(1)
	})

	it("takes files dropped on the text or the card, never as text", () => {
		const composer = mount({}, ["change", "files"])
		const over = new DragEvent("dragover", {
			dataTransfer: transfer([png()]),
			bubbles: true,
			cancelable: true,
		})
		composer.input.dispatchEvent(over)
		expect(over.defaultPrevented).toBe(true)
		const onText = new DragEvent("drop", {
			dataTransfer: transfer([png(), png()]),
			bubbles: true,
			cancelable: true,
		})
		composer.input.dispatchEvent(onText)
		expect(onText.defaultPrevented).toBe(true)
		expect(composer.last("files")).toEqual({ count: 2 })
		const onCard = new DragEvent("drop", {
			dataTransfer: transfer([png()]),
			bubbles: true,
			cancelable: true,
		})
		composer.node.dispatchEvent(onCard)
		expect(composer.all("files")).toEqual([{ count: 2 }, { count: 1 }])
		expect(composer.markdown()).toBe("")
		expect(composer.all("change")).toEqual([])
	})
})
