// @vitest-environment happy-dom
/** Lane A2: `hz:datePicker`'s segments, calendar popover and events (today's DatePicker and TimeField). */
import { afterEach, describe, expect, it } from "vitest"
import * as Segments from "./primitives/controls/date-segments.ts"
import type { Plain } from "./primitives/define.ts"
import { create, type Primitive } from "./primitives.ts"

const mount = (props: Readonly<Record<string, Plain>>) => {
	const primitive = create(document, "hz:datePicker") as Primitive
	const changes: Array<Plain> = []
	primitive.events = {
		handlers: { change: "change" },
		dispatch: (_event, _handler, payload) => {
			changes.push(payload)
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	document.body.append(primitive.outer)
	return { node: primitive.outer, changes, set: primitive.set }
}

const segment = (node: Element, type: string) =>
	node.querySelector(`[data-hz-part=segment][data-type=${type}]`) as HTMLElement
const partOf = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E
const key = (target: Element, name: string) => {
	const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })
	target.dispatchEvent(event)
	return event
}
const typeKeys = (target: Element, keys: string) => {
	for (const each of keys) key(target.ownerDocument.activeElement ?? target, each)
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

afterEach(() => {
	document.body.replaceChildren()
})

describe("date segments", () => {
	const today = { year: 2026, month: 11, day: 27 }

	it("lays out en-US segments and parses ISO text per granularity", () => {
		expect(Segments.order("date")).toEqual(["month", "day", "year"])
		expect(Segments.order("time")).toEqual(["hour", "minute", "dayPeriod"])
		expect(Segments.order("dateTime")).toEqual(["month", "day", "year", "hour", "minute", "dayPeriod"])
		expect(Segments.complete(Segments.make("date", "2026-11-30", today))).toBe("2026-11-30")
		expect(Segments.complete(Segments.make("time", "22:05", today))).toBe("22:05")
		expect(Segments.complete(Segments.make("dateTime", "2026-11-30T00:30", today))).toBe(
			"2026-11-30T00:30",
		)
		expect(Segments.isEmpty(Segments.make("time", "2026-11-30", today))).toBe(true)
	})

	it("types digits with auto-advance, spins from today, and clears with Backspace", () => {
		let state = Segments.make("date", null, today)
		let result = Segments.press(state, "month", "1")
		expect(result.move).toBe(0)
		result = Segments.press(result.state, "month", "2")
		expect(result).toMatchObject({ move: 1 })
		expect(result.state.values.month).toBe(12)
		// 4 cannot start a two-digit day past 31: done at once.
		result = Segments.press(result.state, "day", "4")
		expect(result.move).toBe(1)
		state = Segments.press(result.state, "year", "ArrowUp").state
		expect(state.values.year).toBe(2026)
		expect(Segments.complete(state)).toBe("2026-12-04")
		state = Segments.press(state, "day", "Backspace").state
		expect(state.values.day).toBeNull()
		expect(Segments.press(state, "day", "Backspace").move).toBe(-1)
	})

	it("cycles within limits, rounds minutes to the page step, and takes a and p", () => {
		let state = Segments.make("time", "23:50", today)
		state = Segments.press(state, "minute", "PageUp").state
		expect(state.values.minute).toBe(0)
		state = Segments.press(state, "hour", "ArrowUp").state
		expect(state.values.hour).toBe(12)
		const result = Segments.press(state, "dayPeriod", "a")
		expect(Segments.complete(result.state)).toBe("00:00")
		expect(
			Segments.press(Segments.make("date", "2026-02-10", today), "day", "End").state.values.day,
		).toBe(28)
	})
})

describe("hz:datePicker", () => {
	it("draws a labelled group of spinbuttons with today's ARIA", () => {
		const { node } = mount({ label: "Snooze until", value: "2026-11-30", description: "We remind you." })
		const label = partOf(node, "label")
		const field = partOf(node, "field")
		expect(field.getAttribute("role")).toBe("group")
		expect(field.getAttribute("aria-labelledby")).toBe(label.id)
		const month = segment(node, "month")
		expect(month.getAttribute("role")).toBe("spinbutton")
		expect(month.getAttribute("contenteditable")).toBe("true")
		expect(month.getAttribute("aria-label")).toBe("month, ")
		expect(month.getAttribute("aria-labelledby")).toBe(`${month.id} ${label.id}`)
		expect(month.getAttribute("aria-valuenow")).toBe("11")
		expect(month.getAttribute("aria-valuetext")).toBe("11 – November")
		expect(month.hasAttribute("data-hz-focus")).toBe(true)
		const described = (month.getAttribute("aria-describedby") ?? "").split(" ")
		expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
			"Selected Date: November 30, 2026",
			"We remind you.",
		])
		expect(
			[...node.querySelectorAll("[data-hz-part=segments] > *")].map((span) => span.textContent),
		).toEqual(["11", "/", "30", "/", "2026"])
		const trigger = partOf(node, "trigger")
		expect(trigger.getAttribute("aria-label")).toBe("Calendar")
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog")
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
	})

	it("shows placeholders when empty and raises change once the value is complete", () => {
		const { node, changes } = mount({ label: "Due", value: null })
		expect(segment(node, "month").textContent).toBe("mm")
		expect(segment(node, "month").hasAttribute("data-placeholder")).toBe(true)
		segment(node, "month").focus()
		typeKeys(node, "12")
		expect(document.activeElement).toBe(segment(node, "day"))
		typeKeys(node, "04")
		expect(document.activeElement).toBe(segment(node, "year"))
		expect(changes).toEqual([])
		// As today (React Aria), every keystroke that leaves a complete value reports it.
		typeKeys(node, "2027")
		expect(changes.at(-1)).toEqual({ value: "2027-12-04" })
		expect(partOf(node, "live").textContent).toBe("2027")
	})

	it("arrow keys spin and move between segments; the Model's value echo is ignored", () => {
		const { node, changes, set } = mount({ label: "Due", value: "2026-11-30" })
		const day = segment(node, "day")
		day.focus()
		key(day, "ArrowUp")
		expect(day.textContent).toBe("1")
		expect(changes).toEqual([{ value: "2026-11-01" }])
		set("value", "2026-11-01")
		expect(day.textContent).toBe("1")
		key(day, "ArrowLeft")
		expect(document.activeElement).toBe(segment(node, "month"))
		const tab = key(segment(node, "month"), "Tab")
		expect(tab.defaultPrevented).toBe(false)
	})

	it("clears to null with the clear button, and once every segment is emptied", () => {
		const { node, changes } = mount({ label: "Due", value: "2026-11-30", clearable: true })
		const clear = partOf<HTMLButtonElement>(node, "clear")
		expect(clear.hidden).toBe(false)
		expect(clear.getAttribute("aria-label")).toBe("Clear")
		clear.click()
		expect(changes).toEqual([{ value: null }])
		expect(clear.hidden).toBe(true)
		expect(document.activeElement).toBe(segment(node, "month"))

		const other = mount({ label: "Due", value: "2026-11-05" })
		const day = segment(other.node, "day")
		day.focus()
		key(day, "Backspace")
		expect(other.changes).toEqual([])
		for (const type of ["month", "year"]) {
			const span = segment(other.node, type)
			for (let i = 0; i < 4; i += 1) key(span, "Backspace")
		}
		expect(other.changes).toEqual([{ value: null }])
	})

	it("a time has no calendar; disabled segments leave the tab order", () => {
		const { node, set } = mount({ label: "Quiet hours start", granularity: "time", value: "22:00" })
		expect(partOf(node, "trigger").hidden).toBe(true)
		expect(node.dataset.granularity).toBe("time")
		expect([...node.querySelectorAll("[data-hz-part=segment]")].map((span) => span.textContent)).toEqual([
			"10",
			"00",
			"PM",
		])
		set("disabled", true)
		const hour = segment(node, "hour")
		expect(hour.getAttribute("contenteditable")).toBe("false")
		expect(hour.getAttribute("aria-disabled")).toBe("true")
		expect(hour.hasAttribute("tabindex")).toBe(false)
		expect(node.hasAttribute("data-disabled")).toBe(true)
	})

	it("marks an error or a value out of range invalid", () => {
		const { node, set } = mount({ label: "Due", value: "2026-11-20", min: "2026-11-26" })
		expect(node.hasAttribute("data-invalid")).toBe(true)
		expect(segment(node, "day").getAttribute("aria-invalid")).toBe("true")
		set("value", "2026-11-28")
		expect(node.hasAttribute("data-invalid")).toBe(false)
		set("error", "Pick a later date")
		expect(node.hasAttribute("data-invalid")).toBe(true)
		const error = partOf(node, "error")
		expect(segment(node, "month").getAttribute("aria-describedby")?.split(" ")).toContain(error.id)
	})

	it("opens the calendar on the value's month, moves with the keyboard, and picks a day", async () => {
		const { node, changes } = mount({ label: "Snooze until", value: "2026-11-30", min: "2026-11-26" })
		const trigger = partOf<HTMLButtonElement>(node, "trigger")
		trigger.click()
		await flush()
		expect(trigger.getAttribute("aria-expanded")).toBe("true")
		const panel = partOf(node, "panel")
		expect(panel.getAttribute("role")).toBe("dialog")
		const calendar = partOf(node, "calendar")
		expect(calendar.getAttribute("aria-label")).toBe("Snooze until, November 2026")
		const days = [...node.querySelectorAll<HTMLElement>("[data-hz-part=day]")]
		const selected = days.find((day) => day.hasAttribute("data-selected"))
		expect(selected?.getAttribute("aria-label")).toBe("Monday, November 30, 2026 selected")
		expect(selected?.tabIndex).toBe(0)
		expect(days.filter((day) => day.tabIndex === 0)).toHaveLength(1)
		const before = days.find((day) => day.dataset.date === "2026-11-25")
		expect(before?.getAttribute("aria-disabled")).toBe("true")
		expect(days.find((day) => day.dataset.date === "2026-11-26")?.getAttribute("aria-label")).toBe(
			"Thursday, November 26, 2026, First available date",
		)
		const grid = partOf(node, "grid")
		key(grid, "ArrowRight")
		expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-12-01")
		expect(partOf<HTMLSelectElement>(node, "month").value).toBe("12")
		key(grid, "PageUp")
		key(grid, "ArrowUp")
		// Clamped to `min`.
		expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-26")
		key(grid, "ArrowDown")
		key(grid, "Enter")
		expect(changes).toEqual([{ value: "2026-12-03" }])
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
		expect(segment(node, "day").textContent).toBe("3")
		expect(partOf(node, "status").textContent).toBe("Selected Date: December 3, 2026")
	})

	it("Escape closes the calendar; the page buttons announce the month", async () => {
		const { node } = mount({ label: "Snooze until", value: "2026-11-30" })
		const trigger = partOf<HTMLButtonElement>(node, "trigger")
		trigger.click()
		await flush()
		partOf<HTMLButtonElement>(node, "next").click()
		expect(partOf(node, "live").textContent).toBe("December 2026")
		key(document.activeElement ?? document.body, "Escape")
		await flush()
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
	})

	it("a date and time keeps its time when a day is picked", async () => {
		const { node, changes } = mount({ label: "At", granularity: "dateTime", value: "2026-11-30T09:15" })
		expect(segment(node, "hour").textContent).toBe("9")
		partOf<HTMLButtonElement>(node, "trigger").click()
		await flush()
		;(node.querySelector("[data-date='2026-11-12']") as HTMLElement).click()
		expect(changes).toEqual([{ value: "2026-11-12T09:15" }])
	})
})
