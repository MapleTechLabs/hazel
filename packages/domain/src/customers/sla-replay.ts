/**
 * Replays a support conversation through the SLA reducer, with the alarm firing at every deadline
 * it asks for: the verification fixture for `./sla.ts` (unit tests, the backend's object tests and
 * the demo seed share it).
 *
 * A script is lines of wall times in the business hours' zone, e.g.
 * `["2026-11-20 16:50", "open", "medium"]`, `["2026-11-23 09:20", "reply"]`.
 */
import {
	dueAlerts,
	instantOf,
	markAlerts,
	nextAlertAt,
	openSla,
	type SlaAlert,
	type SlaContext,
	type SlaEvent,
	type SlaIssueStatus,
	type SlaPriority,
	type SlaState,
	stepSla,
} from "./sla"

export type ReplayLine =
	| readonly [at: string, "open", priority: SlaPriority]
	| readonly [at: string, "customer"]
	| readonly [at: string, "reply"]
	| readonly [at: string, "status", status: SlaIssueStatus]
	| readonly [at: string, "priority", priority: SlaPriority]

export interface ReplayStep {
	readonly at: number
	readonly line: ReplayLine | null
	readonly alerts: ReadonlyArray<SlaAlert>
	readonly state: SlaState
}

/** `YYYY-MM-DD HH:MM` in `timeZone` → epoch ms. */
export const wallTime = (text: string, timeZone: string): number => {
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text)
	if (match === null) throw new Error(`Not a wall time: ${text}`)
	const [y, m, d, hh, mm] = match.slice(1).map(Number) as [number, number, number, number, number]
	return instantOf(Date.UTC(y, m - 1, d, hh, mm), timeZone)
}

const eventOf = (line: ReplayLine, at: number): SlaEvent => {
	switch (line[1]) {
		case "open":
			return { _tag: "Opened", at, priority: line[2], customerWaiting: true }
		case "customer":
			return { _tag: "CustomerMessage", at }
		case "reply":
			return { _tag: "TeamReply", at }
		case "status":
			return { _tag: "Status", at, status: line[2] }
		case "priority":
			return { _tag: "Priority", at, priority: line[2] }
	}
}

/**
 * Every step of the replay: each script line, and each alarm turn in between (at the deadline
 * `nextAlertAt` gives, the way the object's alarm does), until `until`.
 */
export const replay = (
	ctx: SlaContext,
	timeZone: string,
	script: ReadonlyArray<ReplayLine>,
	until: string,
): ReadonlyArray<ReplayStep> => {
	const end = wallTime(until, timeZone)
	const lines = script.map((line) => ({ line, at: wallTime(line[0], timeZone) }))
	const first = lines[0]
	if (first === undefined || first.line[1] !== "open") throw new Error("A replay starts with an open")
	let state = openSla(ctx, first.line[2] as SlaPriority, first.at)
	const steps: Array<ReplayStep> = [{ at: first.at, line: first.line, alerts: [], state }]
	const fireAlarmsUntil = (limit: number) => {
		for (let next = nextAlertAt(state); next !== null && next <= limit; next = nextAlertAt(state)) {
			const alerts = dueAlerts(state, next)
			if (alerts.length === 0) break
			state = markAlerts(state, alerts, next)
			steps.push({ at: next, line: null, alerts, state })
		}
	}
	for (const { line, at } of lines.slice(1)) {
		fireAlarmsUntil(at)
		state = stepSla(ctx, state, eventOf(line, at))
		steps.push({ at, line, alerts: [], state })
	}
	fireAlarmsUntil(end)
	return steps
}
