// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { ModalEvents } from "../../modals/feedback"
import { button, byProp, dialog, organizationId, session } from "../../modals/test-support"
import { MarkSignalDone, MarkSignalDoneModalNoDeps } from "./MarkSignalDoneModal"
import { localDateOf } from "./menus"
import { SnoozeSignalUntil, SnoozeUntilModalNoDeps } from "./SnoozeUntilModal"
import { ada, NOW, signalId } from "./test-rows"

/** Needs attention's dialogs, opened through the app's modal layer. */

const close = ModalEvents.RequestedClose()

describe("mark signal as done", () => {
	const props = {
		session,
		signalId: signalId(1),
		accountName: "Kestrel Analytics",
		accountLogoUrl: null,
		title: "Payment failed",
		reason: "$2,150 unpaid",
		severity: "high" as const,
	}

	test("sends the picked outcome and the trimmed note, and closes", () => {
		Scene.start(MarkSignalDoneModalNoDeps, props)
			.expect(dialog("Mark signal as done"))
			.toExist()
			.fire(byProp("choiceGroup", "label", "Outcome"), "change", { selected: ["fixed"] })
			.fire(byProp("textArea", "label", "Note"), "change", { value: "Card updated ", rev: 1, edit: 0 })
			.fire(button("Mark done"), "press")
			.expectExact(
				MarkSignalDone.make({
					organizationId,
					userId: ada,
					signalId: signalId(1),
					outcome: "fixed",
					note: "Card updated ",
				}),
			)
			.emitted(close)
			.resolve(MarkSignalDone, Component.noop)
	})

	test("Cancel only closes", () => {
		Scene.start(MarkSignalDoneModalNoDeps, props)
			.fire(button("Cancel"), "press")
			.emitted(close)
			.expectNone()
	})
})

describe("snooze until a picked day", () => {
	const props = { session, signalId: signalId(1), title: "Payment failed", nowMs: NOW }

	test("starts on tomorrow and snoozes until 9:00 that day", () => {
		const s = Scene.start(SnoozeUntilModalNoDeps, props)
		expect(s.get(byProp("datePicker", "label", "Snooze until")).props?.["value"]).toBe(
			localDateOf(NOW, 1),
		)
		s.fire(byProp("datePicker", "label", "Snooze until"), "change", { value: localDateOf(NOW, 3) })
			.fire(button("Snooze"), "press")
			.expectExact(
				SnoozeSignalUntil.make({
					organizationId,
					userId: ada,
					signalId: signalId(1),
					untilMs: new Date(2026, 10, 29, 9).getTime(),
				}),
			)
			.emitted(close)
			.resolve(SnoozeSignalUntil, Component.noop)
	})

	test("a day that is not after today disables Snooze", () => {
		const s = Scene.start(SnoozeUntilModalNoDeps, props).fire(
			byProp("datePicker", "label", "Snooze until"),
			"change",
			{ value: localDateOf(NOW, -1) },
		)
		expect(s.get(button("Snooze")).props?.["disabled"]).toBe(true)
	})
})
