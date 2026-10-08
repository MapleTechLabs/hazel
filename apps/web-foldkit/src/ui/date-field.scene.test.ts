// @vitest-environment jsdom
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { type DateFieldParts, dateField } from "./date-field"
import { AnnounceValue, FocusSegment, init, Message, type Model, update } from "./date-segments"

/** DateField and TimeField through the view: spinbutton segments, labelling, keyboard and states. */

const fieldView =
	(render: (parts: DateFieldParts) => Array<Html>) =>
	(model: Model, h: HtmlBuilder<Message>): Html =>
		h.div([], dateField(h, { model, toParentMessage: (message: Message) => message }, render))

const labelled = {
	update,
	view: fieldView((f) => [f.label(["Due date"]), f.dateInput(), f.description(["When the task is due."])]),
}
const unlabelled = { update, view: fieldView((f) => [f.dateInput()]) }
const withError = {
	update,
	view: fieldView((f) => [f.label(["Invalid"]), f.dateInput(), f.fieldError(["Pick a weekday."])]),
}

/** Labelled segments are named "<self> <label>"; Foldkit reads the self-reference as the segment text, so locate by type. */
const segment = (type: string) => Scene.selector(`[role="spinbutton"][data-type="${type}"]`)
const group = Scene.role("group")

describe("date field scene", () => {
	test("renders month, day and year spinbuttons with their ranges and values", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date", value: "2026-10-07" })),
			Scene.expectAll(Scene.all.role("spinbutton")).toHaveCount(3),
			Scene.expect(segment("month")).toHaveAttr("aria-valuenow", "10"),
			Scene.expect(segment("month")).toHaveAttr("aria-valuemin", "1"),
			Scene.expect(segment("month")).toHaveAttr("aria-valuemax", "12"),
			Scene.expect(segment("month")).toHaveAttr("aria-valuetext", "10 – October"),
			Scene.expect(segment("day")).toHaveAttr("aria-valuenow", "7"),
			Scene.expect(segment("day")).toHaveAttr("aria-valuemax", "31"),
			Scene.expect(segment("year")).toHaveAttr("aria-valuenow", "2026"),
			Scene.expect(segment("year")).toHaveAttr("aria-valuemax", "9999"),
			Scene.expect(segment("year")).toHaveText("2026"),
		)
	})

	test("the label names the group and every segment, and the description follows the selected date", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date", value: "2026-10-07" })),
			Scene.expect(Scene.role("group", { name: "Due date" })).toExist(),
			Scene.expect(group).toHaveAttr("aria-describedby", "due-selected due-description"),
			Scene.expect(group).toHaveAccessibleDescription(
				"Selected Date: October 7, 2026 When the task is due.",
			),
			Scene.expect(segment("month")).toHaveAttr("aria-labelledby", "due-month due-label"),
			Scene.expect(segment("month")).toHaveAttr("aria-describedby", "due-selected due-description"),
			Scene.expect(segment("day")).not.toHaveAttr("aria-describedby"),
		)
	})

	test("without a label each segment is named by its field", () => {
		Scene.scene(
			unlabelled,
			Scene.given(init({ id: "due", kind: "date" })),
			Scene.expect(Scene.role("spinbutton", { name: "month" })).toHaveText("mm"),
			Scene.expect(Scene.role("spinbutton", { name: "day" })).toHaveAttr("aria-valuetext", "Empty"),
			Scene.expect(Scene.role("spinbutton", { name: "year" })).not.toHaveAttr("aria-valuenow"),
			Scene.expect(group).not.toHaveAttr("aria-labelledby"),
			Scene.expect(group).not.toHaveAttr("aria-describedby"),
		)
	})

	test("ArrowUp on a segment steps it and announces the new value", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date", value: "2026-10-07" })),
			Scene.keydown(segment("day"), "ArrowUp"),
			Scene.Command.expectExact(AnnounceValue({ valueText: "8" })),
			Scene.Command.resolve(AnnounceValue, Message.CompletedAnnounceValue()),
			Scene.expect(segment("day")).toHaveAttr("aria-valuenow", "8"),
			Scene.expect(Scene.selector('input[type="date"]')).toHaveValue("2026-10-08"),
		)
	})

	test("typing a full month moves focus to the day segment", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date" })),
			Scene.keydown(segment("month"), "1"),
			Scene.Command.resolve(AnnounceValue, Message.CompletedAnnounceValue()),
			Scene.keydown(segment("month"), "1"),
			Scene.Command.expectExact(FocusSegment({ elementId: "due-day" })),
			Scene.Command.resolve(FocusSegment, Message.CompletedFocusSegment()),
			Scene.expect(segment("month")).toHaveText("11"),
			Scene.expect(segment("month")).not.toHaveAttr("data-placeholder"),
		)
	})

	test("Tab is left to the browser", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date", value: "2026-10-07" })),
			Scene.expect(segment("month")).toHaveHandler("keydown"),
			Scene.keydown(segment("month"), "Tab"),
			Scene.expectIgnored(),
		)
	})

	test("a disabled field marks the group and segments disabled and takes no keys", () => {
		Scene.scene(
			labelled,
			Scene.given(init({ id: "due", kind: "date", value: "2026-01-15", isDisabled: true })),
			Scene.expect(group).toHaveAttr("aria-disabled", "true"),
			Scene.expect(segment("day")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(segment("day")).toHaveAttr("contenteditable", "false"),
			Scene.expect(segment("day")).toHaveAttr("data-disabled", "true"),
			Scene.expect(Scene.selector('input[type="date"]')).toBeDisabled(),
			Scene.expect(segment("day")).not.toHaveHandler("keydown"),
			Scene.expect(segment("day")).not.toHaveAttr("inputmode"),
			Scene.expect(segment("day")).toHaveAttr("aria-valuenow", "15"),
		)
	})

	test("an invalid field marks segments invalid and describes the group with its error", () => {
		Scene.scene(
			withError,
			Scene.given(init({ id: "inv", kind: "date", value: "2026-02-28", isInvalid: true })),
			Scene.expect(segment("day")).toHaveAttr("aria-invalid", "true"),
			// T7: the day spinbutton ends at February's length.
			Scene.expect(segment("day")).toHaveAttr("aria-valuemax", "28"),
			Scene.expect(group).toHaveAttr("aria-describedby", "inv-selected inv-error"),
			Scene.expect(Scene.text("Pick a weekday.")).toExist(),
		)
	})

	test("a time field renders hour, minute and AM/PM spinbuttons", () => {
		Scene.scene(
			unlabelled,
			Scene.given(init({ id: "at", kind: "time", value: "22:05" })),
			Scene.expect(Scene.role("spinbutton", { name: "hour" })).toHaveAttr("aria-valuenow", "10"),
			Scene.expect(Scene.role("spinbutton", { name: "hour" })).toHaveAttr("aria-valuemin", "1"),
			Scene.expect(Scene.role("spinbutton", { name: "hour" })).toHaveAttr("aria-valuetext", "10 PM"),
			Scene.expect(Scene.role("spinbutton", { name: "minute" })).toHaveText("05"),
			Scene.expect(Scene.role("spinbutton", { name: "AM/PM" })).toHaveText("PM"),
			Scene.expect(Scene.role("spinbutton", { name: "AM/PM" })).not.toHaveAttr("inputmode"),
			Scene.expect(Scene.selector('input[type="date"]')).toBeAbsent(),
			Scene.keydown(Scene.role("spinbutton", { name: "AM/PM" }), "a"),
			Scene.Command.resolve(AnnounceValue, Message.CompletedAnnounceValue()),
			Scene.expect(Scene.role("spinbutton", { name: "AM/PM" })).toHaveText("AM"),
		)
	})
})
