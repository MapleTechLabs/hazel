import { describe, expect, test } from "vitest"
import * as MessageList from "./message-list"

/** The keyboard's scrolls: revealing a focused row, and PageUp / PageDown. */

const ROW = 100
const list = (scrollTop: number): MessageList.Model => ({
	...MessageList.init({ id: "list", estimatedRowHeightPx: ROW, viewportHeight: 400 }),
	keys: Array.from({ length: 20 }, (_, index) => `row-${index}`),
	scrollTop,
	anchor: MessageList.ViewportAnchor.Row({ key: `row-${scrollTop / ROW}`, viewportOffset: 0 }),
})

describe("revealRow", () => {
	test("a row already in view does not scroll", () => {
		const model = list(1000)
		expect(MessageList.revealRow(model, "row-11").model).toBe(model)
	})

	test("a row above the viewport lands just inside its top", () => {
		const result = MessageList.revealRow(list(1000), "row-8")
		expect(result.model.scrollTop).toBe(800 - 16)
		expect(result.commands?.length).toBe(1)
	})

	test("a row below the viewport lands just inside its bottom", () => {
		expect(MessageList.revealRow(list(1000), "row-15").model.scrollTop).toBe(1600 - 400 + 16)
	})

	test("an unknown row does nothing", () => {
		const model = list(1000)
		expect(MessageList.revealRow(model, "nope").model).toBe(model)
	})
})

describe("centerRow", () => {
	test("a row out of view lands in the middle of the viewport", () => {
		expect(MessageList.centerRow(list(1000), "row-3").model.scrollTop).toBe(300 - 150)
		expect(MessageList.centerRow(list(0), "row-15").model.scrollTop).toBe(1500 - 150)
	})

	test("a row already in view does not scroll", () => {
		const model = list(1000)
		expect(MessageList.centerRow(model, "row-12").model).toBe(model)
	})

	test("it stops at the ends", () => {
		expect(MessageList.centerRow(list(1000), "row-0").model.scrollTop).toBe(0)
		expect(MessageList.centerRow(list(0), "row-19").model.scrollTop).toBe(2000 - 400)
	})
})

describe("scrollByPage", () => {
	test("PageUp and PageDown move most of a viewport", () => {
		expect(MessageList.scrollByPage(list(1000), "Up").model.scrollTop).toBe(1000 - 336)
		expect(MessageList.scrollByPage(list(1000), "Down").model.scrollTop).toBe(1000 + 336)
	})

	test("they stop at the ends", () => {
		expect(MessageList.scrollByPage(list(100), "Up").model.scrollTop).toBe(0)
		expect(MessageList.scrollByPage(list(1500), "Down").model.scrollTop).toBe(2000 - 400)
	})
})

describe("the overscan window while scrolling", () => {
	test("a steady scroll moves it every few rows, not at every row boundary", () => {
		const rows = 400
		let model: MessageList.Model = {
			...MessageList.init({ id: "list", estimatedRowHeightPx: 50, viewportHeight: 800 }),
			keys: Array.from({ length: rows }, (_, index) => `row-${index}`),
			scrollTop: 0,
		}
		const windowOf = (current: MessageList.Model) => {
			const phase = current.scrollPhase
			return phase._tag === "Scrolling" ? `${phase.renderedFromKey}..${phase.renderedToKey}` : "settled"
		}
		let changes = 0
		let last = windowOf(model)
		// 10px a frame through 6000px: 120 rows cross each edge of the window.
		for (let top = 10; top <= 6000; top += 10) {
			model = MessageList.update(model, MessageList.Message.ScrolledList({ scrollTop: top })).model
			const now = windowOf(model)
			if (now !== last) changes++
			last = now
		}
		expect(changes).toBeLessThan(60)
		// The viewport is always inside what renders.
		const phase = model.scrollPhase
		if (phase._tag !== "Scrolling") throw new Error("not scrolling")
		const from = model.keys.indexOf(phase.renderedFromKey ?? "")
		const to = model.keys.indexOf(phase.renderedToKey ?? "")
		expect(from * 50).toBeLessThanOrEqual(6000 - 300)
		expect((to + 1) * 50).toBeGreaterThanOrEqual(6000 + 800 + 300)
	})
})

describe("the overscan window after a scroll settles", () => {
	const scrolled = () => {
		let model: MessageList.Model = {
			...MessageList.init({ id: "list", estimatedRowHeightPx: 50, viewportHeight: 800 }),
			keys: Array.from({ length: 400 }, (_, index) => `row-${index}`),
			scrollTop: 0,
		}
		for (let top = 3000; top <= 3600; top += 20)
			model = MessageList.update(model, MessageList.Message.ScrolledList({ scrollTop: top })).model
		return model
	}

	test("stays rendered, and the next scroll goes on from it", () => {
		const scrolling = scrolled()
		const phase = scrolling.scrollPhase
		if (phase._tag !== "Scrolling") throw new Error("not scrolling")
		const settled = MessageList.update(
			scrolling,
			MessageList.Message.CompletedWaitForScrollSettle({ version: phase.eventVersion }),
		).model
		expect(settled.scrollPhase).toEqual(
			MessageList.ScrollPhase.Settled({
				keptFromKey: phase.renderedFromKey,
				keptToKey: phase.renderedToKey,
			}),
		)
		expect(MessageList.keptIndexes(settled, MessageList.layoutOf(settled))).toBeDefined()
		const again = MessageList.update(settled, MessageList.Message.ScrolledList({ scrollTop: 3610 })).model
		const next = again.scrollPhase
		if (next._tag !== "Scrolling") throw new Error("not scrolling")
		expect([next.renderedFromKey, next.renderedToKey]).toEqual([
			phase.renderedFromKey,
			phase.renderedToKey,
		])
	})

	test("is let go once the viewport is elsewhere", () => {
		const scrolling = scrolled()
		const phase = scrolling.scrollPhase
		if (phase._tag !== "Scrolling") throw new Error("not scrolling")
		const settled = MessageList.update(
			scrolling,
			MessageList.Message.CompletedWaitForScrollSettle({ version: phase.eventVersion }),
		).model
		const away = { ...settled, scrollTop: 18000 }
		expect(MessageList.keptIndexes(away, MessageList.layoutOf(away))).toBeUndefined()
	})
})
