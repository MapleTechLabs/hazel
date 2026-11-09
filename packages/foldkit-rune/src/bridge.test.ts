import { beforeAll, describe, expect, it, vi } from "vitest"

import { type HostElementCommand, makeElementBridge } from "./bridge"

class FakeElement extends EventTarget {}

beforeAll(() => {
	Object.assign(globalThis, { HTMLElement: FakeElement })
})

const record = (bridge: ReturnType<typeof makeElementBridge>) => {
	const next = new Map()
	bridge.recordElement("r", undefined, "div", { id: "list" }, [], next)
	bridge.recordElement("r/0", "r", "div", { "data-list-key": "a" }, [], next)
	bridge.recordElement("r/1", "r", "div", { "data-list-key": "b" }, [], next)
	return next
}

/** `getBoundingClientRect().bottom` of a proxy, as the app's context menu reads it. */
const bottomOf = (target: unknown): number => {
	if (typeof target !== "object" || target === null || !("getBoundingClientRect" in target))
		return Number.NaN
	const measure = target.getBoundingClientRect
	const rect: unknown = typeof measure === "function" ? measure.call(target) : undefined
	return typeof rect === "object" && rect !== null && "bottom" in rect && typeof rect.bottom === "number"
		? rect.bottom
		: Number.NaN
}

const mountVNode = (calls: Array<string>) => ({
	data: {
		foldkitMount: { name: "ObserveList" },
		hook: {
			insert: () => calls.push("insert"),
			postpatch: () => calls.push("postpatch"),
			destroy: () => calls.push("destroy"),
		},
	},
})

describe("makeElementBridge", () => {
	it("finds elements by selector in document order, and asks the host to focus and reveal them", () => {
		const sent: Array<HostElementCommand> = []
		// Focus and reveal here; the measure requests a newly observed element sends are covered below.
		const bridge = makeElementBridge({
			mounts: new Set(),
			send: (command) => {
				if (command.t !== "measure") sent.push(command)
			},
		})
		const next = new Map()
		bridge.recordElement("r", undefined, "div", { role: "menu" }, [], next)
		bridge.recordElement("r/0", "r", "button", { id: "first" }, [], next)
		bridge.recordElement("r/1", "r", "div", { tabindex: "-1", id: "skipped" }, [], next)
		bridge.recordElement("r/2", "r", "input", { id: "search" }, [], next)
		bridge.recordElement("r/3", "r", "a", { href: "/x" }, [], next)
		bridge.commit(next, new Map())

		expect(bridge.findPath("#search")).toBe("r/2")
		expect(bridge.findPath("button")).toBe("r/0")
		expect(bridge.findPath("#missing")).toBeUndefined()
		expect(bridge.tabbablePaths()).toEqual(["r/0", "r/2", "r/3"])

		bridge.findById("first")?.focus()
		bridge.findById("search")?.focus()
		bridge.findById("search")?.scrollIntoView({ block: "center" })
		expect(sent).toEqual([
			{ t: "focus", key: "r/0" },
			{ t: "focus", key: "r/2/field" },
			{ t: "reveal", path: "r/2", block: "center" },
		])
	})

	it("starts a geometry Mount once its element has a size, and releases it when it goes", () => {
		const calls: Array<string> = []
		const bridge = makeElementBridge({ mounts: new Set(["ObserveList"]), send: () => {} })
		bridge.commit(record(bridge), new Map([["r", mountVNode(calls)]]))
		expect(calls).toEqual([])
		bridge.reportLayout("r", { x: 0, y: 0, width: 300, height: 200 })
		expect(calls).toEqual(["insert"])
		bridge.commit(record(bridge), new Map([["r", mountVNode(calls)]]))
		expect(calls).toEqual(["insert", "postpatch"])
		bridge.commit(record(bridge), new Map())
		expect(calls).toEqual(["insert", "postpatch", "destroy"])
	})

	it("answers queries, sizes and ResizeObserver from host layout", () => {
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		bridge.commit(record(bridge), new Map())
		const list = bridge.findById("list")
		if (list === null) throw new Error("no #list element")
		const rows = list.querySelectorAll("[data-list-key]")
		expect(Array.from(rows, (row) => row.getAttribute("data-list-key"))).toEqual(["a", "b"])
		const heights: Array<number> = []
		const observer = new bridge.ResizeObserver((entries) => {
			for (const entry of entries) heights.push(entry.contentRect.height)
		})
		observer.observe(rows[1])
		bridge.reportLayout("r/1", { x: 0, y: 40, width: 300, height: 72 })
		expect(heights).toEqual([72])
		expect(rows[1]?.getBoundingClientRect().top).toBe(40)
	})

	it("asks the host to measure an element once, when it is first observed", () => {
		const measured: Array<string> = []
		const bridge = makeElementBridge({
			mounts: new Set(),
			send: (command) => {
				if (command.t === "measure") measured.push(command.path)
			},
		})
		bridge.commit(record(bridge), new Map())
		bridge.widthOf("r")
		bridge.widthOf("r")
		expect(measured).toEqual(["r"])
	})

	it("ignores host scroll reports older than the runtime's own scroll", async () => {
		const sent: Array<number> = []
		const bridge = makeElementBridge({
			mounts: new Set(),
			send: (command) => {
				if (command.t === "scroll") sent.push(command.top)
			},
		})
		bridge.commit(record(bridge), new Map())
		const list = bridge.findById("list")
		if (list === null) throw new Error("no #list element")
		let scrolls = 0
		list.addEventListener("scroll", () => scrolls++)
		list.scrollTop = 480
		bridge.reportScroll("r", 0)
		expect(list.scrollTop).toBe(480)
		expect(scrolls).toBe(0)
		bridge.reportScroll("r", 480)
		bridge.reportScroll("r", 500)
		expect(list.scrollTop).toBe(500)
		// The event follows the rest of the host's batch: one for both reports.
		await Promise.resolve()
		expect(scrolls).toBe(1)
		expect(sent).toEqual([480])
	})

	it("fires scroll once the host's rects for that frame are in, as one batch", async () => {
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		bridge.commit(record(bridge), new Map())
		const list = bridge.findById("list")
		if (list === null) throw new Error("no #list element")
		const seen: Array<number> = []
		list.addEventListener("scroll", () => seen.push(list.scrollTop))
		// The host's order within a frame: the offset, then the rects it moved.
		bridge.reportScroll("r", 200)
		bridge.reportLayout("r", { x: 0, y: -200, width: 100, height: 800 })
		expect(seen).toEqual([])
		await Promise.resolve()
		expect(seen).toEqual([200])
		expect(list.getBoundingClientRect().top).toBe(-200)
	})

	it("takes the host's clamped offset when it never reports another", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		bridge.commit(record(bridge), new Map())
		const list = bridge.findById("list")
		if (list === null) throw new Error("no #list element")
		let scrolls = 0
		list.addEventListener("scroll", () => scrolls++)
		list.scrollTop = 2000
		// The content is only 1800 tall: the host clamps and the viewport stays still after.
		bridge.reportScroll("r", 1800)
		expect(list.scrollTop).toBe(2000)
		vi.advanceTimersByTime(600)
		expect(list.scrollTop).toBe(1800)
		await Promise.resolve()
		expect(scrolls).toBe(1)
		vi.useRealTimers()
	})

	it("treats a sibling whose path extends another's as outside it", () => {
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const next = new Map()
		bridge.recordElement("r", undefined, "div", {}, [], next)
		bridge.recordElement("r/1", "r", "div", { id: "one" }, [], next)
		bridge.recordElement("r/10", "r", "div", { id: "ten" }, [], next)
		bridge.recordElement("r/1/0", "r/1", "div", { id: "child" }, [], next)
		bridge.commit(next, new Map())
		const one = bridge.findById("one")
		expect(one?.contains(bridge.findById("child"))).toBe(true)
		expect(one?.contains(bridge.findById("ten"))).toBe(false)
	})

	it("walks parentElement up to null above the root, as the message toolbar does", () => {
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const next = new Map()
		bridge.recordElement("r", undefined, "div", { id: "root" }, [], next)
		bridge.recordElement("r/0", "r", "div", { id: "list" }, [], next)
		bridge.recordElement("r/0/0", "r/0", "div", { id: "message" }, [], next)
		bridge.commit(next, new Map())
		const ids: Array<string> = []
		for (let at = bridge.findById("message")?.parentElement ?? null; at !== null; at = at.parentElement)
			ids.push(at.id)
		expect(ids).toEqual(["list", "root"])
	})

	it("releases a Mount replaced by a different one in the same slot", () => {
		const calls: Array<string> = []
		const bridge = makeElementBridge({
			mounts: new Set(["ObserveList", "OtherMount"]),
			send: () => {},
		})
		bridge.commit(record(bridge), new Map([["r", mountVNode(calls)]]))
		bridge.reportLayout("r", { x: 0, y: 0, width: 300, height: 200 })
		const other = mountVNode(calls)
		other.data.foldkitMount.name = "OtherMount"
		bridge.commit(record(bridge), new Map([["r", other]]))
		expect(calls).toEqual(["insert", "destroy", "insert"])
	})

	it("dispatches host pointer reports and right-clicks on a pointer-tracking Mount's element", () => {
		const bridge = makeElementBridge({
			mounts: new Set(["TrackHover"]),
			immediateMounts: new Set(["TrackHover"]),
			pointerTargets: new Map([["TrackHover", "[data-list-key]"]]),
			send: () => {},
		})
		const seen: Array<string> = []
		/** The key of the row an event's target sits in, as the app's delegated listener finds it. */
		const rowKey = (target: unknown) => {
			if (typeof target !== "object" || target === null || !("closest" in target)) return undefined
			const closest = target.closest
			if (typeof closest !== "function") return undefined
			const row: unknown = closest.call(target, "[data-list-key]")
			if (typeof row !== "object" || row === null || !("getAttribute" in row)) return undefined
			const getAttribute = row.getAttribute
			return typeof getAttribute === "function" ? getAttribute.call(row, "data-list-key") : undefined
		}
		const vnode = {
			data: {
				foldkitMount: { name: "TrackHover" },
				hook: {
					insert: (v: { elm?: unknown }) => {
						if (!(v.elm instanceof EventTarget)) return
						v.elm.addEventListener("pointerover", (event) =>
							seen.push(`over ${rowKey(event.target)}`),
						)
						v.elm.addEventListener("pointerleave", () => seen.push("leave"))
						v.elm.addEventListener("contextmenu", (event) => {
							const y =
								"clientY" in event && typeof event.clientY === "number" ? event.clientY : 0
							const x = "clientX" in event ? event.clientX : undefined
							// As a context menu measures the pointer against its trigger.
							seen.push(
								`menu ${rowKey(event.target)} ${x},${y} below ${y - bottomOf(event.target)}`,
							)
						})
					},
				},
			},
		}
		bridge.commit(record(bridge), new Map([["r", vnode]]))
		expect(bridge.pointerSelector("TrackHover")).toBe("[data-list-key]")
		bridge.dispatchPointer({ path: "r/1", mount: "r", inside: true })
		bridge.dispatchPointer({ path: "r/1", mount: "r", inside: false })
		bridge.dispatchPointer({ path: "r", mount: "r", inside: false })
		bridge.dispatchContextMenu({
			t: "contextmenu",
			path: "r/0",
			mount: "r",
			x: 12,
			y: 34,
			rects: { "r/0": [0, 20, 100, 10] },
		})
		expect(seen).toEqual(["over b", "leave", "menu a 12,34 below 4"])
	})
})
