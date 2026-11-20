import { describe, expect, test } from "vitest"
import { EMPTY_SUPPORT_REPORT, SUPPORT_REPORT } from "../../../lab/fixtures/issues"
import { makeShared } from "../../../test/pages-fixtures"
import { Message } from "./message"
import { isEmptyReport, type Model } from "./model"
import { init, sharedChanged, update } from "./update"

/** Update-loop tests for the Support report: loading per range, stale answers, failure and retry. */

const shared = makeShared({ nowMs: Date.UTC(2026, 10, 10, 12) })

const run = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message, shared).model, model)
const commandNames = (result: { readonly commands?: ReadonlyArray<{ readonly name: string }> }) =>
	(result.commands ?? []).map((command) => command.name)

const loaded = run(init(undefined, shared).model, [
	Message.SucceededFetchReport({ range: "30d", report: SUPPORT_REPORT }),
])

describe("support report", () => {
	test("opens on 30 days and asks for them; without an organization, once it arrives", () => {
		const opened = init(undefined, shared)
		expect(opened.model.range).toBe("30d")
		expect(opened.model.report._tag).toBe("Loading")
		expect(commandNames(opened)).toEqual(["FetchSupportReport"])
		const early = init(undefined, makeShared({ organization: null }))
		expect(commandNames(early)).toEqual([])
		expect(commandNames(sharedChanged(early.model, shared))).toEqual(["FetchSupportReport"])
		expect(loaded.report._tag).toBe("Success")
	})

	test("a range switch keeps the numbers while it loads, and drops a late answer for the old range", () => {
		const switched = update(loaded, Message.ClickedRange({ range: "90d" }), shared)
		expect(commandNames(switched)).toEqual(["FetchSupportReport"])
		expect(switched.model.report._tag).toBe("Refreshing")
		const stale = run(switched.model, [
			Message.SucceededFetchReport({ range: "30d", report: EMPTY_SUPPORT_REPORT }),
		])
		expect(stale.report._tag).toBe("Refreshing")
		const settled = run(switched.model, [
			Message.SucceededFetchReport({ range: "90d", report: EMPTY_SUPPORT_REPORT }),
		])
		expect(settled.report._tag).toBe("Success")
		expect(commandNames(update(loaded, Message.ClickedRange({ range: "30d" }), shared))).toEqual([])
	})

	test("a failure shows (not the old range's numbers) and retry asks again", () => {
		const failed = run(loaded, [
			Message.ClickedRange({ range: "7d" }),
			Message.FailedFetchReport({ range: "7d", reason: "Offline" }),
		])
		expect(failed.report._tag).toBe("Failure")
		expect(
			run(loaded, [Message.FailedFetchReport({ range: "90d", reason: "Offline" })]).report._tag,
		).toBe("Success")
		expect(commandNames(update(failed, Message.PressedRetry(), shared))).toEqual(["FetchSupportReport"])
	})

	test("the chart toggles between median and within SLA; an empty range is the empty state", () => {
		expect(run(loaded, [Message.ClickedChart({ chart: "within" })]).chart).toBe("within")
		expect(run(loaded, [Message.HoveredDay({ index: 4 })]).hoveredDay).toBe(4)
		expect(
			run(loaded, [Message.HoveredDay({ index: 4 }), Message.ClickedRange({ range: "7d" })]).hoveredDay,
		).toBeNull()
		expect(isEmptyReport(SUPPORT_REPORT)).toBe(false)
		expect(isEmptyReport(EMPTY_SUPPORT_REPORT)).toBe(true)
	})
})
