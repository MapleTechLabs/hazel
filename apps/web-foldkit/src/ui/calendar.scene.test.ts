// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { Announce, FocusCell, FocusCellOnPress, init, Message, OutMessage, update } from "./calendar"
import { view } from "./calendar-view"
import * as Select from "./select"

/** Calendar and RangeCalendar through the view: grid roles, selection state, paging and clicks. */

// Fixed dates: March 2026, today the 5th, nothing reads the clock.
const today = "2026-03-05"
const sceneView = Scene.withViewInputs(view, { ariaLabel: "Event date" })
const config = { update, view: sceneView() }
const day = (name: string) => Scene.role("button", { name })
const selectedCell = Scene.role("gridcell", { selected: true })
const disabledCells = Scene.all.role("gridcell", { disabled: true })
// The month and year Selects each mount their trigger's press focus helper (not exported, so by name).
const triggerMount = { name: "FocusSelectTriggerOnPress" }
const mounted = [
	Scene.Mount.resolve(triggerMount, Select.Message.CompletedPortalSelect()),
	Scene.Mount.resolve(triggerMount, Select.Message.CompletedPortalSelect()),
]
const resolveAnnounce = Scene.Command.resolve(Announce, Message.CompletedAnnounce())

describe("calendar scene", () => {
	test("renders a labelled grid with a month heading and the selected day", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.expect(Scene.role("application", { name: "Event date, March 2026" })).toExist(),
			Scene.expect(Scene.role("heading", { name: "Event date, March 2026" })).toExist(),
			Scene.expect(Scene.role("grid", { name: "Event date, March 2026" })).toExist(),
			Scene.expectAll(Scene.all.role("gridcell")).toHaveCount(35),
			Scene.expect(selectedCell).toHaveText("18"),
			Scene.expect(day("Wednesday, March 18, 2026 selected")).toHaveAttr("data-selected", "true"),
			Scene.expect(day("Today, Thursday, March 5, 2026")).toHaveAttr("data-today", "true"),
		)
	})

	test("days of the adjacent months are shown disabled", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.expectAll(disabledCells).toHaveCount(4),
			Scene.expect(day("Wednesday, April 1, 2026")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(day("Wednesday, April 1, 2026")).toHaveAttr("data-outside-month", "true"),
			Scene.expect(day("Sunday, March 1, 2026")).not.toHaveAttr("aria-disabled"),
		)
	})

	test("clicking a day selects it and tells the parent", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.click(day("Friday, March 20, 2026")),
			Scene.expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-20" })),
			resolveAnnounce,
			Scene.expect(selectedCell).toHaveText("20"),
			Scene.expect(day("Friday, March 20, 2026 selected")).toExist(),
			Scene.expect(day("Wednesday, March 18, 2026")).not.toHaveAttr("aria-selected"),
		)
	})

	test("the Next button shows the following month and announces it", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.click(Scene.role("button", { name: "Next" })),
			Scene.Command.expectExact(Announce({ message: "April 2026", timeout: 7000, assertiveness: "assertive" })),
			resolveAnnounce,
			Scene.expect(Scene.role("grid", { name: "Event date, April 2026" })).toExist(),
			Scene.click(Scene.role("button", { name: "Previous" })),
			resolveAnnounce,
			Scene.expect(Scene.role("heading", { name: "Event date, March 2026" })).toExist(),
		)
	})

	test("days before the minimum are disabled and so is the Previous button", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "deadline", today, minValue: "2026-03-10" })),
			...mounted,
			Scene.expectAll(disabledCells).toHaveCount(13),
			Scene.expect(day("Monday, March 9, 2026")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(day("Tuesday, March 10, 2026, First available date")).not.toHaveAttr("aria-disabled"),
			Scene.expect(Scene.role("button", { name: "Previous" })).toBeDisabled(),
		)
	})

	test("arrow keys on the grid move focus to the next day", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.keydown(Scene.role("grid"), "ArrowRight"),
			Scene.Command.expectExact(FocusCell({ gridId: "event-grid", label: "Thursday, March 19, 2026" })),
			Scene.Command.resolve(FocusCell, Message.CompletedFocusCell()),
			Scene.expect(selectedCell).toHaveText("18"),
		)
	})
	test("Enter on the grid selects the focused day", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "event", today, value: "2026-03-18" })),
			...mounted,
			Scene.keydown(Scene.role("grid"), "ArrowRight"),
			Scene.Command.resolve(FocusCell, Message.CompletedFocusCell()),
			Scene.keydown(Scene.role("grid"), "Enter"),
			Scene.expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-19" })),
			resolveAnnounce,
			Scene.expect(selectedCell).toHaveText("19"),
		)
	})
})

const rangeConfig = { update, view: sceneView({ ariaLabel: "Trip dates" }) }
const trip = init({ id: "trip", mode: "Range", today, range: { start: "2026-03-09", end: "2026-03-13" } })
const selectedCells = Scene.all.role("gridcell", { selected: true })
const rangeMounted = [...mounted, Scene.Mount.resolve(FocusCellOnPress, Message.CompletedFocusCellOnPress())]

describe("range calendar scene", () => {
	test("renders a multiselectable grid with the committed range selected", () => {
		Scene.scene(
			rangeConfig,
			Scene.given(trip),
			...rangeMounted,
			Scene.expect(Scene.role("grid", { name: "Trip dates, March 2026" })).toHaveAttr("aria-multiselectable", "true"),
			Scene.expectAll(selectedCells).toHaveCount(5),
			Scene.expect(
				day("Selected Range: Monday, March 9 to Friday, March 13, 2026, Monday, March 9, 2026 selected"),
			).toHaveAttr("data-selection-start", "true"),
			Scene.expect(day("Wednesday, March 11, 2026 selected")).not.toHaveAttr("data-selection-end"),
		)
	})

	test("clicking two days previews on hover, then commits the range and tells the parent", () => {
		Scene.scene(
			rangeConfig,
			Scene.given(trip),
			...rangeMounted,
			Scene.click(day("Monday, March 16, 2026")),
			Scene.expectNoOutMessage(),
			Scene.expectAll(selectedCells).toHaveCount(1),
			Scene.hover(day("Thursday, March 19, 2026")),
			Scene.expectAll(selectedCells).toHaveCount(4),
			Scene.click(day("Thursday, March 19, 2026 selected")),
			Scene.expectOutMessage(OutMessage.ChangedRange({ start: "2026-03-16", end: "2026-03-19" })),
			resolveAnnounce,
			Scene.expect(
				day("Selected Range: Monday, March 16 to Thursday, March 19, 2026, Thursday, March 19, 2026 selected"),
			).toHaveAttr("data-selection-end", "true"),
		)
	})
})
