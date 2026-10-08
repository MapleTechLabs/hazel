// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Calendar from "./calendar"
import { init, Message, OutMessage, PortalPicker, update } from "./date-picker"
import { view } from "./date-picker-view"
import * as Select from "./select"

/** DatePicker through the view: the trigger, the calendar popover, committing a day, the segments. */

const today = "2026-03-12"
const sceneView = Scene.withViewInputs(view, { label: "Due date" })
const config = { update, view: sceneView() }

// Foldkit's accessible name skips the trigger's own aria-label when it is self-referenced in aria-labelledby.
const trigger = Scene.role("button", { name: /Due date/ })
const dialog = Scene.role("dialog")
const day = (name: string) => Scene.role("button", { name })
/** Labelled segments are named "<self> <label>", which the same self-reference gap reduces to their text. */
const segment = (type: string) => Scene.selector(`[role="spinbutton"][data-type="${type}"]`)

/** The calendar's selection announcement; `Announce` is not exported from calendar.ts, so match the instance. */
const resolveSelectionAnnouncement = (date: string) => {
	const calendar = Calendar.init({ id: "due-calendar", today })
	const [announcement] = Calendar.update(calendar, Calendar.Message.ClickedCell({ date })).commands ?? []
	return announcement === undefined
		? Scene.Command.expectNone()
		: Scene.Command.resolve(announcement, Calendar.Message.CompletedAnnounce())
}

/** The calendar's month and year Selects each mount a press-focus helper (not exported from select-view.ts). */
const selectTriggerMount = { name: "FocusSelectTriggerOnPress" }
/** Fresh step instances per use: a shared expectEnded step object failed to acknowledge in a second scene. */
const openPicker = () => [
	Scene.click(trigger),
	Scene.Mount.resolve(PortalPicker, Message.CompletedPortalPicker()),
	Scene.Mount.resolveAll(
		[selectTriggerMount, Select.Message.CompletedPortalSelect()],
		[selectTriggerMount, Select.Message.CompletedPortalSelect()],
	),
]
const pickerClosed = () => Scene.Mount.expectEnded(PortalPicker, selectTriggerMount, selectTriggerMount)

describe("date picker scene", () => {
	test("renders a labelled group with a collapsed calendar trigger and no dialog", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today })),
			Scene.expect(Scene.role("group", { name: "Due date" })).toExist(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).toHaveAttr("aria-haspopup", "dialog"),
			Scene.expect(trigger).toHaveAttr("aria-label", "Calendar"),
			Scene.expect(trigger).toHaveAttr("aria-labelledby", "due-trigger due-label"),
			Scene.expect(dialog).toBeAbsent(),
		)
	})

	test("pressing the trigger opens the calendar dialog and expands the trigger", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today })),
			...openPicker(),
			Scene.expect(dialog).toExist(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(Scene.role("grid")).toExist(),
		)
	})

	test("picking a day closes the dialog, reports the date and fills the segments", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today })),
			...openPicker(),
			Scene.click(day("Friday, March 20, 2026")),
			Scene.expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-20" })),
			resolveSelectionAnnouncement("2026-03-20"),
			pickerClosed(),
			Scene.expect(dialog).toBeAbsent(),
			Scene.expect(segment("month")).toHaveAttr("aria-valuenow", "3"),
			Scene.expect(segment("day")).toHaveAttr("aria-valuenow", "20"),
			Scene.expect(segment("year")).toHaveAttr("aria-valuenow", "2026"),
			Scene.expect(trigger).toHaveAttr("aria-describedby", "due-description"),
		)
	})

	test("Escape in the dialog closes it without changing the value", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today, value: "2026-03-18" })),
			...openPicker(),
			Scene.keydown(dialog, "a"),
			Scene.expectIgnored(),
			Scene.keydown(dialog, "Escape"),
			pickerClosed(),
			Scene.expectNoOutMessage(),
			Scene.expect(dialog).toBeAbsent(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(segment("day")).toHaveAttr("aria-valuenow", "18"),
		)
	})

	test("the hidden Dismiss button and a second trigger press both close the dialog", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today })),
			...openPicker(),
			Scene.click(Scene.role("button", { name: "Dismiss" })),
			pickerClosed(),
			Scene.expect(dialog).toBeAbsent(),
			...openPicker(),
			Scene.click(trigger),
			pickerClosed(),
			Scene.expect(dialog).toBeAbsent(),
		)
	})

	test("an existing value shows in the segments and describes the trigger", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today, value: "2026-03-18" })),
			Scene.expect(segment("month")).toHaveText("3"),
			Scene.expect(segment("day")).toHaveText("18"),
			Scene.expect(segment("year")).toHaveText("2026"),
			Scene.expect(segment("month")).toHaveAttr("aria-valuetext", "3 \u2013 March"),
			Scene.expect(trigger).toHaveAttr("aria-describedby", "due-description"),
			Scene.expect(Scene.role("group", { name: "Due date" })).toHaveAttr(
				"aria-describedby",
				"due-description",
			),
		)
	})

	test("an empty picker shows placeholder segments", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today })),
			Scene.expect(segment("month")).toHaveText("mm"),
			Scene.expect(segment("month")).toHaveAttr("data-placeholder", "true"),
			Scene.expect(segment("month")).toHaveAttr("aria-valuetext", "Empty"),
			Scene.expect(segment("month")).not.toHaveAttr("aria-valuenow"),
			Scene.expect(trigger).not.toHaveAttr("aria-describedby"),
		)
	})

	test("without a visible label the group takes the aria-label", () => {
		Scene.scene(
			{ update, view: sceneView({ label: undefined, ariaLabel: "Clear status after" }) },
			Scene.given(init({ id: "status", today })),
			// Self-referencing aria-labelledby resolves to the aria-label in browsers; Foldkit's name query misses it.
			Scene.expect(Scene.selector("#status-group")).toHaveAttr("aria-label", "Clear status after"),
			Scene.expect(Scene.selector("#status-group")).toHaveAttr("aria-labelledby", "status-group"),
			Scene.expect(Scene.label("Clear status after")).toExist(),
			Scene.expect(Scene.role("spinbutton", { name: /Clear status after/ })).toExist(),
		)
	})

	test("days before the minimum are disabled in the open calendar", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "due", today, minValue: "2026-03-10" })),
			...openPicker(),
			Scene.expect(day("Thursday, March 5, 2026")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(day("Friday, March 20, 2026")).not.toHaveAttr("aria-disabled"),
		)
	})
})
