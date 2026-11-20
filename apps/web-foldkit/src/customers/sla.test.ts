import { describe, expect, test } from "vitest"
import { NOW } from "../lab/fixtures/customers"
import { ISSUE_SLAS, ISSUES } from "../lab/fixtures/issues"
import { formatSlaDuration, overdueByMs, slaChipCopy, slaDisplayOf } from "./sla"

/** The SLA chip's copy over the fixtures, one per state (`docs/customers/sla.md` §3). */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe("formatSlaDuration", () => {
	test.each([
		[30_000, "1m"],
		[45 * MINUTE, "45m"],
		[3 * HOUR, "3h"],
		[3 * HOUR + 10 * MINUTE, "3h 10m"],
		[2 * 24 * HOUR + 4 * HOUR + 20 * MINUTE, "2d 4h"],
		[5 * 24 * HOUR, "5d"],
	])("%d ms reads %s", (ms, text) => {
		expect(formatSlaDuration(ms)).toBe(text)
	})
})

describe("slaChipCopy", () => {
	const nowMs = NOW.getTime()
	const copyOf = (index: number) => {
		const sla = ISSUE_SLAS[index]
		const issue = ISSUES[index]
		if (sla === undefined || issue === undefined) throw new Error(`No fixture ${index}`)
		return slaChipCopy(slaDisplayOf(sla, nowMs), {
			policyName: sla.policyName,
			nowMs,
			status: issue.status,
		})
	}

	test("each fixture shows its state, tone and policy", () => {
		expect(copyOf(0)).toMatchObject({ text: "Reply due in 8m", tone: "warning" })
		expect(copyOf(1)).toMatchObject({ text: "Reply overdue by 1h", tone: "danger" })
		expect(copyOf(2)).toMatchObject({ text: "Reply due in 3h 42m", tone: "quiet" })
		expect(copyOf(3)).toMatchObject({ text: "Paused · waiting on customer", tone: "muted" })
		expect(copyOf(4)).toMatchObject({ text: "Reply due in 1h", tone: "warning" })
		expect(copyOf(5)).toMatchObject({ text: "Paused · on hold", tone: "muted" })
		expect(copyOf(6)).toMatchObject({ text: "First reply in 8m", tone: "met" })
		expect(copyOf(7)).toMatchObject({ text: "First reply in 5h · late", tone: "muted" })
		expect(copyOf(4)?.title).toMatch(/^Enterprise policy · due /)
	})

	test("a running resolution reads as resolve-in, then overdue", () => {
		const paused = ISSUE_SLAS[3]
		if (paused === undefined) throw new Error("No fixture")
		const running = {
			...paused,
			state: {
				...paused.state,
				resolution: {
					...paused.state.resolution,
					runningSince: nowMs - HOUR,
					dueAt: nowMs + 2 * 24 * HOUR + 4 * HOUR,
					warnAt: nowMs + 24 * HOUR,
					pausedAt: null,
				},
			},
		}
		expect(slaChipCopy(slaDisplayOf(running, nowMs), { policyName: "Standard", nowMs })?.text).toBe(
			"Resolve in 2d 4h",
		)
		const later = nowMs + 2 * 24 * HOUR + 7 * HOUR
		expect(
			slaChipCopy(slaDisplayOf(running, later), { policyName: "Standard", nowMs: later })?.text,
		).toBe("Resolution overdue by 3h")
	})

	test("no row, no chip; overdue only for a breached clock", () => {
		expect(slaChipCopy(slaDisplayOf(undefined, nowMs), { policyName: "x", nowMs })).toBeNull()
		expect(overdueByMs(ISSUE_SLAS[1], nowMs)).toBe(HOUR)
		expect(overdueByMs(ISSUE_SLAS[0], nowMs)).toBeNull()
	})
})
