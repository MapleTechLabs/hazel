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
