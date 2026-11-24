/**
 * The signal lifecycle and priority (`./lifecycle.ts`).
 */
import type { SignalEvidence } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import type { Match } from "./evaluate"
import { priorityScore, transition, valueOf } from "./lifecycle"
import { accountRow, NOW, signalRow } from "./test-kit"

const evidence = (step: 0 | 1 | 2): SignalEvidence => ({
	_tag: "last_active",
	step,
	lastActiveAt: null,
	daysInactive: 20,
	priorActiveUsers: 3,
	contactId: null,
	contactName: null,
	contactEmail: null,
})

const matchOf = (step: 0 | 1 | 2, severity: Match["severity"] = "medium"): Match => ({
	_tag: "Match",
	severity,
	title: "Stopped using the product",
	reason: `No activity (${step})`,
	evidence: evidence(step),
})

const days = (count: number) => count * 86_400_000
const at = (offsetDays: number) => new Date(NOW.getTime() + days(offsetDays))
const input = { now: NOW, baseline: false, valueMinor: 19_900 }

describe("signal lifecycle", () => {
	it("opens a new match, or records it dismissed in baseline mode", () => {
		expect(transition(null, matchOf(0), input)).toMatchObject({
			_tag: "Insert",
			status: "open",
			event: { type: "signal.opened" },
		})
		expect(transition(null, matchOf(0), { ...input, baseline: true })).toMatchObject({
			_tag: "Insert",
			status: "dismissed",
			event: null,
		})
		expect(transition(null, null, input)).toEqual({ _tag: "Keep" })
	})

	it("refreshes an open signal and auto-resolves it once false", () => {
		const open = signalRow({
			evidence: evidence(0),
			reason: "No activity (0)",
			severity: "medium",
			priorityScore: priorityScore("medium", 19_900, NOW, NOW),
		})
		expect(transition(open, matchOf(0), input)).toEqual({ _tag: "Keep" })
		const worse = transition(open, matchOf(1, "high"), input)
		expect(worse).toMatchObject({
			_tag: "Update",
			patch: { severity: "high", evidence: evidence(1) },
			event: null,
		})
		expect(transition(open, null, input)).toMatchObject({
			_tag: "Update",
			patch: { status: "auto_resolved", closedAt: NOW },
			event: { type: "signal.resolved" },
		})
	})

	it("wakes a snooze at its end, or early once a full step worse", () => {
		const snoozed = signalRow({
			evidence: evidence(0),
			status: "snoozed",
			snoozedUntil: at(3),
			actionEvidence: evidence(0),
		})
		expect(transition(snoozed, matchOf(0), input)).toMatchObject({ _tag: "Update" })
		expect((transition(snoozed, matchOf(0), input) as { patch: object }).patch).not.toHaveProperty(
			"status",
		)
		expect(transition(snoozed, matchOf(1, "high"), input)).toMatchObject({
			_tag: "Update",
			patch: { status: "open", snoozedUntil: null },
			event: { type: "signal.woke", data: { early: true } },
		})
		expect(transition(snoozed, matchOf(0), { ...input, now: at(4) })).toMatchObject({
			patch: { status: "open" },
			event: { type: "signal.woke", data: { early: false } },
		})
		expect(transition(snoozed, null, input)).toMatchObject({
			patch: { status: "auto_resolved", closedAt: NOW },
		})
	})

	it("keeps a done signal muted while true, however long; closes it once false", () => {
		const done = signalRow({
			evidence: evidence(0),
			status: "done",
			outcome: "contacted",
			actionEvidence: evidence(0),
		})
		expect(transition(done, matchOf(0), { ...input, now: at(2) })).toMatchObject({ _tag: "Update" })
		expect(transition(done, matchOf(0), { ...input, now: at(2) })).not.toHaveProperty("patch.status")
		expect(transition(done, matchOf(2), { ...input, now: at(30) })).not.toHaveProperty("patch.status")
		expect(transition(done, null, input)).toMatchObject({ patch: { closedAt: NOW }, event: null })
		expect(transition(done, null, input)).not.toHaveProperty("patch.status")
	})

	it("keeps a dismissed signal until a full step worse", () => {
		const dismissed = signalRow({
			evidence: evidence(0),
			status: "dismissed",
			dismissReason: "baseline",
			actionEvidence: evidence(0),
		})
		expect(transition(dismissed, matchOf(0), input)).not.toHaveProperty("patch.status")
		expect(transition(dismissed, matchOf(1), input)).toMatchObject({
			patch: { status: "open", dismissReason: null, reopenCount: 1 },
			event: { type: "signal.reopened", data: { from: "dismissed" } },
		})
		expect(transition(dismissed, null, input)).toMatchObject({ patch: { closedAt: NOW } })
		// Worse in baseline mode (old data arriving): still dismissed, at the new evidence.
		const baseline = transition(dismissed, matchOf(1), { ...input, baseline: true })
		expect(baseline).toMatchObject({
			_tag: "Update",
			event: null,
			patch: { actionEvidence: evidence(1) },
		})
		expect(baseline).not.toHaveProperty("patch.status")
	})
})

describe("priority", () => {
	it("ranks by severity, then value (MRR, else the trial's list price), fading with age", () => {
		const high = priorityScore("high", 0, NOW, NOW)
		const medium = priorityScore("medium", 0, NOW, NOW)
		expect(high).toBe(4)
		expect(medium).toBe(2)
		expect(priorityScore("medium", 1_000_000, NOW, NOW)).toBeGreaterThan(
			priorityScore("medium", 4_900, NOW, NOW),
		)
		expect(priorityScore("high", 0, at(-14), NOW)).toBe(2)
		expect(priorityScore("high", 0, at(-60), NOW)).toBe(2)
		expect(valueOf(accountRow({ mrrMinor: 0, trialListMrrMinor: 79_900 }))).toBe(79_900)
		expect(valueOf(accountRow({ mrrMinor: 4_900, trialListMrrMinor: 79_900 }))).toBe(4_900)
		expect(valueOf(accountRow({ mrrMinor: 0, trialListMrrMinor: null }))).toBe(0)
	})
})
