/**
 * The pure scoring: health components, weight redistribution and bands (`./health.ts`); the signal
 * lifecycle and priority (`./lifecycle.ts`).
 */
import { DEFAULT_HEALTH_SETTINGS, type SignalEvidence } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import type { Match } from "./evaluate"
import { type HealthInputs, maxStep, minStep, scoreHealth } from "./health"
import { priorityScore, transition, valueOf } from "./lifecycle"
import { accountRow, NOW, signalRow } from "./test-kit"

const inputs = (overrides: Partial<HealthInputs> = {}): HealthInputs => ({
	churned: false,
	hasActivityData: true,
	contactCount: 10,
	activeUsers30d: 7,
	trendPct: 12,
	daysSinceActive: 0,
	billing: { pastDue: false, overdueOverWeek: false, overdue: false, cancelScheduled: false },
	openRisk: { high: 0, medium: 0, low: 0 },
	...overrides,
})

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

describe("health score", () => {
	it("steps pick the first threshold the value passes", () => {
		const steps = DEFAULT_HEALTH_SETTINGS.steps
		expect(minStep(steps.usage.activeRatio, 0.7)).toBe(100)
		expect(minStep(steps.usage.activeRatio, 0.25)).toBe(50)
		expect(minStep(steps.usage.activeRatio, 0)).toBe(0)
		expect(maxStep(steps.engagement.daysSinceActive, 0)).toBe(100)
		expect(maxStep(steps.engagement.daysSinceActive, 10)).toBe(50)
		expect(maxStep(steps.engagement.daysSinceActive, 400)).toBe(0)
	})

	it("a healthy account scores 100 and explains each component", () => {
		const result = scoreHealth(inputs(), DEFAULT_HEALTH_SETTINGS)
		expect(result).toMatchObject({ score: 100, status: "healthy" })
		expect(result.components.find((part) => part.key === "usage")?.why).toBe(
			"7 of 10 contacts active in 30 days; trend +12%",
		)
		expect(result.components.every((part) => !part.excluded)).toBe(true)
	})

	it("bands the weighted score", () => {
		const result = scoreHealth(
			inputs({
				activeUsers30d: 2,
				trendPct: -40,
				daysSinceActive: 10,
				billing: { pastDue: true, overdueOverWeek: true, overdue: true, cancelScheduled: false },
				openRisk: { high: 1, medium: 1, low: 0 },
			}),
			DEFAULT_HEALTH_SETTINGS,
		)
		// usage 0.6×50 + 0.4×10 = 34; engagement 50; billing 20; signals 55.
		expect(result.components.map((part) => part.score)).toEqual([34, 50, 20, 55])
		expect(result.score).toBe(Math.round(0.35 * 34 + 0.25 * 50 + 0.25 * 20 + 0.15 * 55))
		expect(result.status).toBe("critical")
		expect(result.components.find((part) => part.key === "billing")?.why).toBe(
			"Payment past due; Invoice overdue for over a week",
		)
	})

	it("shares an excluded component's weight across the rest", () => {
		const result = scoreHealth(inputs({ billing: null, daysSinceActive: 10 }), DEFAULT_HEALTH_SETTINGS)
		const billing = result.components.find((part) => part.key === "billing")!
		expect(billing).toMatchObject({
			excluded: true,
			score: null,
			effectiveWeight: 0,
			why: "No subscription",
		})
		const weights = result.components.map((part) => part.effectiveWeight)
		expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(100)
		expect(result.components.find((part) => part.key === "usage")?.effectiveWeight).toBeCloseTo(
			(35 / 75) * 100,
		)
		expect(result.score).toBe(Math.round((35 / 75) * 100 + (25 / 75) * 50 + (15 / 75) * 100))
	})

	it("has no score for churned accounts, or with only signals to go on", () => {
		expect(scoreHealth(inputs({ churned: true }), DEFAULT_HEALTH_SETTINGS)).toMatchObject({
			score: null,
			status: "unknown",
		})
		expect(
			scoreHealth(inputs({ hasActivityData: false, billing: null }), DEFAULT_HEALTH_SETTINGS),
		).toMatchObject({
			score: null,
			status: "unknown",
		})
		// A billing-only org still gets a score.
		expect(scoreHealth(inputs({ hasActivityData: false }), DEFAULT_HEALTH_SETTINGS).score).toBe(100)
	})
})

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

	it("reopens a done signal still true after the cooldown; closes it once false", () => {
		const done = signalRow({
			evidence: evidence(0),
			status: "done",
			reopenAfter: at(7),
			outcome: "contacted",
			actionEvidence: evidence(0),
		})
		expect(transition(done, matchOf(0), { ...input, now: at(2) })).toMatchObject({ _tag: "Update" })
		expect(transition(done, matchOf(0), { ...input, now: at(2) })).not.toHaveProperty("patch.status")
		expect(transition(done, matchOf(0), { ...input, now: at(8) })).toMatchObject({
			patch: { status: "open", reopenCount: 1, openedAt: at(8), outcome: null, reopenAfter: null },
			event: { type: "signal.reopened" },
		})
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
