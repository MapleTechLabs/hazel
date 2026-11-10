import { describe, expect, it } from "vitest"
import { type FrameEventsOptions, makeFrameEvents } from "./frames"

/** What the web app reads while a frame's `message` is dispatched (`bridgeStream`, chat/html-render.ts). */
const setup = () => {
	const frameWindow = { name: "frame" }
	const frame = { contentWindow: frameWindow }
	const window = new EventTarget()
	const document: FrameEventsOptions["document"] = { activeElement: null }
	const navigator: FrameEventsOptions["navigator"] = {}
	const fired: Array<string> = []
	const heard: Array<{ source: unknown; data: unknown; isFocused: boolean; isActive: boolean }> = []
	window.addEventListener("message", (event) => {
		const { source, data } = event as Event & { source: unknown; data: unknown }
		heard.push({
			source,
			data,
			isFocused: document.activeElement === frame,
			isActive: navigator.userActivation?.isActive ?? false,
		})
	})
	const frameEvents = makeFrameEvents({
		frameAt: (path) => (path === "r/1" ? frame : null),
		fire: (path, event) => fired.push(`${path}#${event.type}`),
		window,
		document,
		navigator,
	})
	return { frameEvents, frameWindow, frame, document, navigator, fired, heard }
}

describe("makeFrameEvents", () => {
	it("runs the frame element's load handler", () => {
		const { frameEvents, fired, heard } = setup()
		frameEvents({ t: "frame", path: "r/1", event: "load" })
		expect(fired).toEqual(["r/1#load"])
		expect(heard).toEqual([])
	})

	it("dispatches a page's message on window, from the frame's own window", () => {
		const { frameEvents, frameWindow, heard } = setup()
		const data = { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 300 } }
		frameEvents({ t: "frame", path: "r/1", event: "message", data, active: false })
		expect(heard).toEqual([{ source: frameWindow, data, isFocused: false, isActive: false }])
	})

	it("reads as focused and acted in only while an active message is dispatched", () => {
		const { frameEvents, document, navigator, heard } = setup()
		const before = { other: true }
		document.activeElement = before
		frameEvents({ t: "frame", path: "r/1", event: "message", data: {}, active: true })
		expect(heard.map(({ isFocused, isActive }) => [isFocused, isActive])).toEqual([[true, true]])
		expect(document.activeElement).toBe(before)
		expect(navigator.userActivation).toBeUndefined()
	})

	it("drops a message from a frame the tree no longer has", () => {
		const { frameEvents, heard } = setup()
		frameEvents({ t: "frame", path: "r/gone", event: "message", data: {}, active: true })
		expect(heard).toEqual([])
	})
})
