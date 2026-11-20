import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	addWorkingTime,
	BusinessHours,
	DEFAULT_SLA_POLICY,
	openSla,
	outcomeOf,
	policyFor,
	quantile,
	type SlaCalendar,
	type SlaContext,
	slaDisplay,
	stepSla,
	supportReport,
	workingTimeBetween,
} from "./sla"
import { replay, wallTime } from "./sla-replay"

const MIN = 60_000
const berlin: SlaCalendar = {
	_tag: "business",
	hours: { timeZone: "Europe/Berlin", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
}
const at = (text: string) => wallTime(text, "Europe/Berlin")
const iso = (ms: number) => new Date(ms).toISOString()

describe("business hours", () => {
	it("carries a Friday-evening target over the weekend", () => {
		// Fri 2026-11-20 16:50 + 1h → Mon 09:50 (CET, UTC+1).
		expect(iso(addWorkingTime(berlin, at("2026-11-20 16:50"), 60 * MIN))).toBe("2026-11-23T08:50:00.000Z")
	})

	it("starts the clock at opening time when the message arrives at night", () => {
		expect(iso(addWorkingTime(berlin, at("2026-11-17 22:10"), 30 * MIN))).toBe("2026-11-18T08:30:00.000Z")
	})

	it("crosses the end of summer time", () => {
		// Fri 2026-10-23 16:30 CEST (14:30Z) + 1h → Mon 2026-10-26 09:30 CET (08:30Z).
		expect(iso(addWorkingTime(berlin, at("2026-10-23 16:30"), 60 * MIN))).toBe("2026-10-26T08:30:00.000Z")
		expect(workingTimeBetween(berlin, at("2026-10-23 16:30"), at("2026-10-26 09:30"))).toBe(60 * MIN)
	})

	it("spans several working days", () => {
		// 3 working days (24h) from Wed 10:00 → Mon 10:00.
		expect(addWorkingTime(berlin, at("2026-11-18 10:00"), 24 * 60 * MIN)).toBe(at("2026-11-23 10:00"))
	})

	it("counts wall time on a 24/7 policy", () => {
		expect(addWorkingTime({ _tag: "always" }, 0, 90 * MIN)).toBe(90 * MIN)
	})

	it("rejects overnight hours and unknown zones", () => {
		const decode = Schema.decodeUnknownExit(BusinessHours)
		expect(decode({ timeZone: "UTC", days: [1], start: "22:00", end: "06:00" })._tag).toBe("Failure")
		expect(decode({ timeZone: "Mars/Base", days: [1], start: "09:00", end: "17:00" })._tag).toBe(
			"Failure",
		)
		expect(decode({ timeZone: "America/New_York", days: [1], start: "09:00", end: "17:00" })._tag).toBe(
			"Success",
		)
	})
})

describe("policies", () => {
	const policy = (
		position: number,
		appliesTo: Partial<typeof DEFAULT_SLA_POLICY.appliesTo>,
		enabled = true,
	) => ({
		...DEFAULT_SLA_POLICY,
		position,
		enabled,
		name: `p${position}`,
		appliesTo: { accountIds: [], planNames: [], tagsAny: [], ...appliesTo },
	})
	const policies = [
		policy(0, { planNames: ["Enterprise"] }),
		policy(1, { tagsAny: ["vip"] }),
		policy(2, { accountIds: ["acme"] }),
		policy(3, {}),
		policy(4, { planNames: ["Pro"] }, false),
	]

	it("prefers an account named by id, then plan or tag in order, then the default", () => {
		expect(policyFor(policies, { id: "acme", planName: "Enterprise", tags: [] })?.name).toBe("p2")
		expect(policyFor(policies, { id: "x", planName: "Enterprise", tags: ["vip"] })?.name).toBe("p0")
		expect(policyFor(policies, { id: "x", planName: "Free", tags: ["vip"] })?.name).toBe("p1")
		expect(policyFor(policies, { id: "x", planName: "Pro", tags: [] })?.name).toBe("p3")
		expect(policyFor([policies[0]!], { id: "x", planName: null, tags: [] })).toBeUndefined()
	})
})

const ctx: SlaContext = { targets: DEFAULT_SLA_POLICY.targets, calendar: berlin, warnBeforePct: 25 }

describe("replay", () => {
	it("Friday evening question, Monday answer: first response met, resolution paused while waiting", () => {
		// medium: 4h first response, 24h resolution (business).
		const steps = replay(
			ctx,
			"Europe/Berlin",
			[
				["2026-11-20 16:50", "open", "medium"],
				["2026-11-23 09:20", "reply"],
				["2026-11-23 09:21", "status", "waiting_on_customer"],
				["2026-11-25 11:00", "customer"],
				["2026-11-25 11:05", "status", "waiting_on_us"],
				["2026-11-25 13:55", "reply"],
				["2026-11-25 14:30", "status", "closed"],
			],
			"2026-11-30 09:00",
		)
		const last = steps.at(-1)!.state
		const outcome = outcomeOf(last, ctx.targets)
		// 10 working minutes Friday + 20 Monday.
		expect(outcome.firstResponseMs).toBe(30 * MIN)
		expect(outcome.firstResponseOnTime).toBe(true)
		// Running: Fri 16:50–17:00 (10m) + Mon 09:00–09:21 (21m) + Wed 11:00–14:30 (3h30) = 4h01m.
		expect(outcome.resolutionMs).toBe(241 * MIN)
		expect(outcome.resolutionOnTime).toBe(true)
		// The second reply clock (customer wrote Wed 11:00) was met at 13:55, before its 14:00 warning: no alerts fired.
		expect(last.reply?.first).toBe(false)
		expect(last.reply?.metAt).toBe(at("2026-11-25 13:55"))
		expect(steps.flatMap((step) => step.alerts)).toEqual([])
		expect(slaDisplay(last, ctx.targets, at("2026-11-30 09:00"))).toEqual({
			_tag: "Met",
			clock: "reply",
			elapsedMs: 30 * MIN,
			onTime: true,
		})
	})

	it("warns at 75% of the target and breaches at the deadline, once each", () => {
		// urgent: 1h first response → warn 09:45, breach 10:00.
		const steps = replay(
			ctx,
			"Europe/Berlin",
			[
				["2026-11-23 09:00", "open", "urgent"],
				["2026-11-23 11:30", "reply"],
			],
			"2026-11-23 12:00",
		)
		const alerts = steps.filter((step) => step.alerts.length > 0)
		expect(alerts.map((step) => [iso(step.at), step.alerts.map((a) => `${a.clock}:${a.kind}`)])).toEqual([
			[iso(at("2026-11-23 09:45")), ["reply:warning"]],
			[iso(at("2026-11-23 10:00")), ["reply:breach"]],
		])
		const outcome = outcomeOf(steps.at(-1)!.state, ctx.targets)
		expect(outcome.firstResponseMs).toBe(150 * MIN)
		expect(outcome.firstResponseOnTime).toBe(false)
	})

	it("shows each live state", () => {
		const [opened, , paused] = replay(
			ctx,
			"Europe/Berlin",
			[
				["2026-11-23 09:00", "open", "high"],
				["2026-11-23 09:30", "reply"],
				["2026-11-23 09:31", "status", "waiting_on_customer"],
			],
			"2026-11-23 09:31",
		)
		const state = opened!.state
		// high: 2h → due 11:00, warn 10:30.
		expect(slaDisplay(state, ctx.targets, at("2026-11-23 10:00"))._tag).toBe("OnTime")
		expect(slaDisplay(state, ctx.targets, at("2026-11-23 10:40"))._tag).toBe("DueSoon")
		expect(slaDisplay(state, ctx.targets, at("2026-11-23 12:00"))).toMatchObject({
			_tag: "Breached",
			clock: "reply",
			dueAt: at("2026-11-23 11:00"),
		})
		// Resolution (16h) paused after 31 minutes.
		expect(slaDisplay(paused!.state, ctx.targets, at("2026-11-24 10:00"))).toEqual({
			_tag: "Paused",
			leftMs: (16 * 60 - 31) * MIN,
		})
	})

	it("re-targets a running clock when the priority rises, and a reopen counts on from before", () => {
		const steps = replay(
			ctx,
			"Europe/Berlin",
			[
				["2026-11-23 09:00", "open", "low"],
				["2026-11-23 09:10", "priority", "urgent"],
				["2026-11-23 09:20", "reply"],
				["2026-11-23 10:00", "status", "closed"],
				["2026-11-24 09:00", "customer"],
				["2026-11-24 09:30", "reply"],
				["2026-11-24 10:00", "status", "closed"],
			],
			"2026-11-24 12:00",
		)
		const raised = steps[1]!.state
		expect(raised.reply?.dueAt).toBe(at("2026-11-23 10:00"))
		const last = steps.at(-1)!.state
		// Resolved after 1h, reopened for 1h: 2h.
		expect(outcomeOf(last, ctx.targets).resolutionMs).toBe(120 * MIN)
		expect(last.firstResponse?.elapsedMs).toBe(20 * MIN)
	})
})

describe("issue shapes", () => {
	it("an issue a member opened on a team message waits for no reply until the customer writes", () => {
		const opened = openSla(ctx, "medium", at("2026-11-23 09:00"), false)
		expect(opened.reply).toBeNull()
		const wrote = stepSla(ctx, opened, { _tag: "CustomerMessage", at: at("2026-11-23 10:00") })
		expect(wrote.reply).toMatchObject({ first: true, dueAt: at("2026-11-23 14:00") })
	})

	it("a late delivery of an earlier team reply moves the first response back", () => {
		const [, replied] = replay(
			ctx,
			"Europe/Berlin",
			[
				["2026-11-23 09:00", "open", "medium"],
				["2026-11-23 11:00", "reply"],
			],
			"2026-11-23 11:00",
		)
		const earlier = stepSla(ctx, replied!.state, { _tag: "TeamReply", at: at("2026-11-23 09:30") })
		expect(earlier.firstResponse?.elapsedMs).toBe(30 * MIN)
		expect(earlier.reply?.metAt).toBe(at("2026-11-23 09:30"))
	})
})

describe("support report", () => {
	const always: SlaContext = { ...ctx, calendar: { _tag: "always" } }
	// Medium (24/7): 4h reply, 24h resolution.
	const issue = (id: string, account: string, script: Parameters<typeof replay>[2], until: string) => ({
		issueId: id,
		accountId: account,
		accountName: account === "a" ? "Acme" : "Globex",
		policyName: "Standard",
		openedAt: at(script[0]![0]),
		targets: always.targets,
		state: replay(always, "Europe/Berlin", script, until).at(-1)!.state,
	})
	const rows = [
		// Answered in 30m, resolved in 2h.
		issue(
			"1",
			"a",
			[
				["2026-11-23 09:00", "open", "medium"],
				["2026-11-23 09:30", "reply"],
				["2026-11-23 11:00", "status", "closed"],
			],
			"2026-11-23 12:00",
		),
		// Answered late (5h).
		issue(
			"2",
			"a",
			[
				["2026-11-23 10:00", "open", "medium"],
				["2026-11-23 15:00", "reply"],
			],
			"2026-11-23 16:00",
		),
		// Never answered: overdue now.
		issue("3", "b", [["2026-11-24 09:00", "open", "medium"]], "2026-11-24 09:00"),
	]

	it("medians, p90, share within target and breaches, by account", () => {
		const report = supportReport(rows, at("2026-11-20 00:00"), at("2026-11-24 18:00"))
		expect(report.issues).toBe(3)
		expect(report.firstResponse).toEqual({
			count: 2,
			medianMs: 30 * MIN,
			p90Ms: 300 * MIN,
			withinPct: 0.5,
		})
		expect(report.resolution).toEqual({ count: 1, medianMs: 120 * MIN, p90Ms: 120 * MIN, withinPct: 1 })
		expect(report.breaches).toBe(2)
		// 2's resolution (24h) is past too, and 3 is unanswered.
		expect(report.overdueNow).toBe(2)
		expect(report.byAccount.map((row) => [row.label, row.issues, row.breaches])).toEqual([
			["Acme", 2, 1],
			["Globex", 1, 1],
		])
		expect(report.daily.find((day) => day.day === "2026-11-23")).toMatchObject({
			issues: 2,
			withinPct: 0.5,
		})
	})

	it("leaves out issues opened before the range, but counts them overdue", () => {
		const report = supportReport(rows, at("2026-11-24 00:00"), at("2026-11-24 18:00"))
		expect(report.issues).toBe(1)
		expect(report.firstResponse.count).toBe(0)
		expect(report.firstResponse.medianMs).toBeNull()
		expect(report.overdueNow).toBe(2)
	})
})

describe("quantile", () => {
	it("is nearest-rank", () => {
		expect(quantile([], 0.5)).toBeNull()
		expect(quantile([5, 1, 3], 0.5)).toBe(3)
		expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
	})
})
