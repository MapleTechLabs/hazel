// @vitest-environment jsdom
import { Effect, Fiber, Stream } from "effect"
import { afterEach, describe, expect, test } from "vitest"
import { adaMessageId, graceMessageId } from "./fixtures.test-support"
import { TrackMessageKeys } from "./message-keys"
import { Message } from "./model"

/** `TrackMessageKeys` on real DOM events: which keys it takes, and from where. */

let cleanup: (() => void) | null = null
afterEach(() => {
	cleanup?.()
	cleanup = null
	document.body.innerHTML = ""
})

const row = (messageId: string) => {
	const element = document.createElement("div")
	element.id = `message-${messageId}`
	element.dataset.id = messageId
	element.setAttribute("data-message-row", "")
	element.tabIndex = -1
	element.append(Object.assign(document.createElement("button"), { textContent: "React" }))
	return element
}

/** The list with two rows, the Mount running on it; returns the Messages it emitted so far. */
const mounted = () => {
	const list = document.createElement("div")
	list.append(row(graceMessageId), row(adaMessageId))
	document.body.append(list)
	const seen: Array<Message> = []
	const fiber = Effect.runFork(
		TrackMessageKeys()
			.f(list, Stream.empty)
			.pipe(Stream.runForEach((message) => Effect.sync(() => seen.push(message)))),
	)
	cleanup = () => Effect.runSync(Fiber.interrupt(fiber))
	return { list, seen }
}

const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event.defaultPrevented
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("TrackMessageKeys", () => {
	test("a key on a focused message is reported and taken", async () => {
		const { list, seen } = mounted()
		await settle()
		const grace = list.querySelector(`#message-${graceMessageId}`)!
		expect(press(grace, "r")).toBe(true)
		await settle()
		expect(seen).toContainEqual(Message.PressedMessageKey({ messageId: graceMessageId, key: "Reply" }))
	})

	test("keys inside a message (its buttons) keep their default", async () => {
		const { list, seen } = mounted()
		await settle()
		const button = list.querySelector(`#message-${graceMessageId} button`)!
		expect(press(button, "r")).toBe(false)
		expect(press(button, "ArrowUp")).toBe(false)
		await settle()
		expect(seen.filter((message) => message._tag === "PressedMessageKey")).toEqual([])
	})

	test("Mod+C over selected text is the browser's copy", async () => {
		const { list, seen } = mounted()
		await settle()
		const grace = list.querySelector<HTMLElement>(`#message-${graceMessageId}`)!
		grace.append("Launch window confirmed")
		const range = document.createRange()
		range.selectNodeContents(grace)
		window.getSelection()!.addRange(range)
		expect(press(grace, "c", { ctrlKey: true })).toBe(false)
		window.getSelection()!.removeAllRanges()
		expect(press(grace, "c", { ctrlKey: true })).toBe(true)
		await settle()
		expect(seen.filter((message) => message._tag === "PressedMessageKey")).toEqual([
			Message.PressedMessageKey({ messageId: graceMessageId, key: "Copy" }),
		])
	})

	test("focusing a message reports it; focusing inside one does not", async () => {
		const { list, seen } = mounted()
		await settle()
		list.querySelector<HTMLElement>(`#message-${adaMessageId}`)!.focus()
		list.querySelector<HTMLElement>(`#message-${graceMessageId} button`)!.focus()
		await settle()
		expect(seen.filter((message) => message._tag === "FocusedMessage")).toEqual([
			Message.FocusedMessage({ messageId: adaMessageId }),
		])
	})
})
