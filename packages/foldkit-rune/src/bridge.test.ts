import { beforeAll, describe, expect, it, vi } from "vitest"

import { makeElementBridge } from "./bridge"

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
	it("starts a geometry Mount once its element has a size, and releases it when it goes", () => {
		const calls: Array<string> = []
		const bridge = makeElementBridge({ mounts: new Set(["ObserveList"]), sendScroll: () => {} })
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
		const bridge = makeElementBridge({ mounts: new Set(), sendScroll: () => {} })
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

	it("ignores host scroll reports older than the runtime's own scroll", () => {
		const sent: Array<number> = []
		const bridge = makeElementBridge({
			mounts: new Set(),
			sendScroll: (command) => sent.push(command.top),
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
		expect(scrolls).toBe(1)
		expect(sent).toEqual([480])
	})

	it("takes the host's clamped offset when it never reports another", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
		const bridge = makeElementBridge({ mounts: new Set(), sendScroll: () => {} })
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
		expect(scrolls).toBe(1)
		vi.useRealTimers()
	})

	it("treats a sibling whose path extends another's as outside it", () => {
		const bridge = makeElementBridge({ mounts: new Set(), sendScroll: () => {} })
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

	it("releases a Mount replaced by a different one in the same slot", () => {
		const calls: Array<string> = []
		const bridge = makeElementBridge({
			mounts: new Set(["ObserveList", "OtherMount"]),
			sendScroll: () => {},
		})
		bridge.commit(record(bridge), new Map([["r", mountVNode(calls)]]))
		bridge.reportLayout("r", { x: 0, y: 0, width: 300, height: 200 })
		const other = mountVNode(calls)
		other.data.foldkitMount.name = "OtherMount"
		bridge.commit(record(bridge), new Map([["r", other]]))
		expect(calls).toEqual(["insert", "destroy", "insert"])
	})

	it("dispatches host pointer reports on a pointer-tracking Mount's element", () => {
		const bridge = makeElementBridge({
			mounts: new Set(["TrackHover"]),
			immediateMounts: new Set(["TrackHover"]),
			pointerTargets: new Map([["TrackHover", "[data-list-key]"]]),
			sendScroll: () => {},
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
					},
				},
			},
		}
		bridge.commit(record(bridge), new Map([["r", vnode]]))
		expect(bridge.pointerSelector("TrackHover")).toBe("[data-list-key]")
		bridge.dispatchPointer({ path: "r/1", mount: "r", inside: true })
		bridge.dispatchPointer({ path: "r/1", mount: "r", inside: false })
		bridge.dispatchPointer({ path: "r", mount: "r", inside: false })
		expect(seen).toEqual(["over b", "leave"])
	})
})
