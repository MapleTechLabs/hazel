/**
 * Support SLAs (`docs/customers/sla.md`): policies, the org's business hours, and the SLA clocks of
 * one issue as a pure reducer over its events. The `CustomersObject` folds each issue change into
 * the stored state, the replay fixture folds a whole conversation, and reports read the result.
 *
 * Clocks:
 * - **reply due**: starts when the issue opens (the first response) and again when the customer
 *   writes after the team replied (or a closed issue reopens); met by the next team reply. Only the
 *   first one counts as first response time in reports.
 * - **resolution**: runs from open to close, paused while waiting on the customer or on hold.
 *
 * Times are epoch milliseconds. A policy on business hours counts only working time; one on
 * `always` counts wall time.
 */
import { Schema } from "effect"

// ---------------------------------------------------------------------------------------------
// Policies and hours

export const SlaPriority = Schema.Literals(["urgent", "high", "medium", "low"])
export type SlaPriority = typeof SlaPriority.Type

/** An issue's priority (`IssuePriority`): one without a priority gets medium's targets. */
export const slaPriorityOf = (priority: "none" | SlaPriority): SlaPriority =>
	priority === "none" ? "medium" : priority

const Minutes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 * 24 * 90 }))
const Clock = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):([0-5]\d)$/))

export const SlaTarget = Schema.Struct({
	firstResponseMinutes: Minutes,
	resolutionMinutes: Minutes,
}).check(
	Schema.makeFilter((target) =>
		target.firstResponseMinutes <= target.resolutionMinutes
			? undefined
			: "The first response target must not exceed the resolution target",
	),
)
export type SlaTarget = typeof SlaTarget.Type

export const SlaTargets = Schema.Struct({
	urgent: SlaTarget,
	high: SlaTarget,
	medium: SlaTarget,
	low: SlaTarget,
})
export type SlaTargets = typeof SlaTargets.Type

/** ISO weekday: 1 Monday … 7 Sunday. */
export const Weekday = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 }))
export type Weekday = typeof Weekday.Type

const isTimeZone = (zone: string) => {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone })
		return true
	} catch {
		return false
	}
}

/** The org's working week, in one time zone; `end` after `start` (no overnight shifts). */
export const BusinessHours = Schema.Struct({
	timeZone: Schema.String.check(
		Schema.makeFilter((zone) => (isTimeZone(zone) ? undefined : "Unknown time zone")),
	),
	days: Schema.Array(Weekday).check(Schema.isMinLength(1), Schema.isMaxLength(7)),
	start: Clock,
	end: Clock,
}).check(
	Schema.makeFilter((hours) => (hours.start < hours.end ? undefined : "Hours must end after they start")),
)
export type BusinessHours = typeof BusinessHours.Type

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
	timeZone: "UTC",
	days: [1, 2, 3, 4, 5],
	start: "09:00",
	end: "17:00",
}

export const SlaHours = Schema.Literals(["business", "always"])
export type SlaHours = typeof SlaHours.Type

/** Which accounts a policy covers; every list empty = the default (any account). Any list matching is enough. */
export const SlaAppliesTo = Schema.Struct({
	accountIds: Schema.Array(Schema.String).check(Schema.isMaxLength(500)),
	planNames: Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(50)),
	tagsAny: Schema.Array(Schema.String.check(Schema.isMaxLength(50))).check(Schema.isMaxLength(50)),
})
export type SlaAppliesTo = typeof SlaAppliesTo.Type

const Pct = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 90 }))

/** A policy as the editor submits it. */
export const SlaPolicyDraft = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
	enabled: Schema.Boolean,
	appliesTo: SlaAppliesTo,
	targets: SlaTargets,
	hours: SlaHours,
	/** Warn this share of the target before it is due (0 = only at breach). */
	warnBeforePct: Pct,
})
export type SlaPolicyDraft = typeof SlaPolicyDraft.Type

const target = (firstResponseMinutes: number, resolutionMinutes: number): SlaTarget => ({
	firstResponseMinutes,
	resolutionMinutes,
})

/** The policy every org starts with: business hours, any account. */
export const DEFAULT_SLA_POLICY: SlaPolicyDraft = {
	name: "Standard",
	enabled: true,
	appliesTo: { accountIds: [], planNames: [], tagsAny: [] },
	targets: {
		urgent: target(60, 8 * 60),
		high: target(2 * 60, 16 * 60),
		medium: target(4 * 60, 3 * 8 * 60),
		low: target(8 * 60, 5 * 8 * 60),
	},
	hours: "business",
	warnBeforePct: 25,
}

export interface PolicyAccount {
	readonly id: string
	readonly planName: string | null
	readonly tags: ReadonlyArray<string>
}

const isDefault = (appliesTo: SlaAppliesTo) =>
	appliesTo.accountIds.length === 0 && appliesTo.planNames.length === 0 && appliesTo.tagsAny.length === 0

/** Whether a policy names the account (by id, plan or tag), or is a default one. */
export const policyCovers = (appliesTo: SlaAppliesTo, account: PolicyAccount): boolean =>
	isDefault(appliesTo) ||
	appliesTo.accountIds.includes(account.id) ||
	(account.planName !== null && appliesTo.planNames.includes(account.planName)) ||
	appliesTo.tagsAny.some((tag) => account.tags.includes(tag))

/**
 * The account's policy: the first enabled one (by `position`) naming it by id, then by plan or tag,
 * then the first default one. An account named by id wins over a plan rule above it.
 */
export const policyFor = <
	P extends { readonly position: number } & Pick<SlaPolicyDraft, "enabled" | "appliesTo">,
>(
	policies: ReadonlyArray<P>,
	account: PolicyAccount,
): P | undefined => {
	const ordered = policies
		.filter((policy) => policy.enabled)
		.slice()
		.sort((a, b) => a.position - b.position)
	return (
		ordered.find((policy) => policy.appliesTo.accountIds.includes(account.id)) ??
		ordered.find((policy) => !isDefault(policy.appliesTo) && policyCovers(policy.appliesTo, account)) ??
		ordered.find((policy) => isDefault(policy.appliesTo))
	)
}

// ---------------------------------------------------------------------------------------------
// Calendar: working time between instants

/** Business hours, or none (wall time). */
export type SlaCalendar =
	| { readonly _tag: "always" }
	| { readonly _tag: "business"; readonly hours: BusinessHours }

export const calendarOf = (hours: SlaHours, businessHours: BusinessHours): SlaCalendar =>
	hours === "always" ? { _tag: "always" } : { _tag: "business", hours: businessHours }

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Business-hours walks stop after this many days (a long target over a short week). */
const MAX_WALK_DAYS = 3 * 366

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatterOf = (timeZone: string) => {
	let formatter = formatters.get(timeZone)
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		})
		formatters.set(timeZone, formatter)
	}
	return formatter
}

/** The zone's offset from UTC at `at`, in ms (local = UTC + offset). */
const offsetAt = (at: number, timeZone: string): number => {
	const parts = new Map<string, number>()
	for (const part of formatterOf(timeZone).formatToParts(at))
		if (part.type !== "literal") parts.set(part.type, Number(part.value))
	const of = (type: string) => parts.get(type) ?? 0
	const local = Date.UTC(of("year"), of("month") - 1, of("day"), of("hour"), of("minute"), of("second"))
	return local - (at - (at % 1000))
}

/** The instant of a local wall time (`localMs` = the wall time read as UTC). A skipped time maps forward. */
export const instantOf = (localMs: number, timeZone: string): number => {
	const first = localMs - offsetAt(localMs, timeZone)
	return localMs - offsetAt(first, timeZone)
}

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))

/** The local midnight (as UTC-read ms) of the day `at` falls on. */
const localDayOf = (at: number, timeZone: string) => {
	const local = at + offsetAt(at, timeZone)
	return local - (((local % DAY) + DAY) % DAY)
}

/** ISO weekday of a local midnight. */
const weekdayOf = (localDay: number) => ((new Date(localDay).getUTCDay() + 6) % 7) + 1

/** The working window of the local day, as instants; none on a day off. */
const windowOf = (localDay: number, hours: BusinessHours): readonly [number, number] | undefined =>
	hours.days.includes(weekdayOf(localDay))
		? [
				instantOf(localDay + minutesOf(hours.start) * MINUTE, hours.timeZone),
				instantOf(localDay + minutesOf(hours.end) * MINUTE, hours.timeZone),
			]
		: undefined

/** `from` plus `ms` of working time. */
export const addWorkingTime = (calendar: SlaCalendar, from: number, ms: number): number => {
	if (calendar._tag === "always") return from + ms
	const { hours } = calendar
	let left = ms
	let day = localDayOf(from, hours.timeZone)
	for (let i = 0; i < MAX_WALK_DAYS; i++, day += DAY) {
		const window = windowOf(day, hours)
		if (window === undefined) continue
		const start = Math.max(window[0], from)
		if (start >= window[1]) continue
		if (left <= window[1] - start) return start + left
		left -= window[1] - start
	}
	return from + MAX_WALK_DAYS * DAY
}

/** Working time between two instants (0 when `to` ≤ `from`). */
export const workingTimeBetween = (calendar: SlaCalendar, from: number, to: number): number => {
	if (to <= from) return 0
	if (calendar._tag === "always") return to - from
	const { hours } = calendar
	let total = 0
	let day = localDayOf(from, hours.timeZone)
	for (let i = 0; i < MAX_WALK_DAYS && day <= to + DAY; i++, day += DAY) {
		const window = windowOf(day, hours)
		if (window === undefined) continue
		const start = Math.max(window[0], from)
		const end = Math.min(window[1], to)
		if (end > start) total += end - start
	}
	return total
}

// ---------------------------------------------------------------------------------------------
// One issue's clocks

/** A reply-due clock: met by the next team reply. */
export const ReplyClock = Schema.Struct({
	/** The issue's first response (reported), or a later reply after the customer wrote again. */
	first: Schema.Boolean,
	startedAt: Schema.Finite,
	dueAt: Schema.Finite,
	warnAt: Schema.Finite,
	/** Met by a team reply; `stoppedAt` instead when the issue closed first. */
	metAt: Schema.NullOr(Schema.Finite),
	stoppedAt: Schema.NullOr(Schema.Finite),
	/** Working time from start to the reply. */
	elapsedMs: Schema.NullOr(Schema.Finite),
	warnedAt: Schema.NullOr(Schema.Finite),
	breachedAt: Schema.NullOr(Schema.Finite),
})
export type ReplyClock = typeof ReplyClock.Type

export const ResolutionClock = Schema.Struct({
	/** Running since (null while paused or resolved). */
	runningSince: Schema.NullOr(Schema.Finite),
	/** Working time counted before `runningSince`. */
	consumedMs: Schema.Finite,
	/** While running; null while paused or resolved. */
	dueAt: Schema.NullOr(Schema.Finite),
	warnAt: Schema.NullOr(Schema.Finite),
	pausedAt: Schema.NullOr(Schema.Finite),
	resolvedAt: Schema.NullOr(Schema.Finite),
	warnedAt: Schema.NullOr(Schema.Finite),
	breachedAt: Schema.NullOr(Schema.Finite),
})
export type ResolutionClock = typeof ResolutionClock.Type

/** The SLA state of one issue, stored as JSON. */
export const SlaState = Schema.Struct({
	priority: SlaPriority,
	/** The latest reply-due clock (met, stopped, or running). */
	reply: Schema.NullOr(ReplyClock),
	/** The first response, frozen once met: what reports count. */
	firstResponse: Schema.NullOr(ReplyClock),
	resolution: ResolutionClock,
})
export type SlaState = typeof SlaState.Type

/** The issue statuses the clocks care about. */
export type SlaIssueStatus = "new" | "waiting_on_us" | "waiting_on_customer" | "on_hold" | "closed"

export type SlaEvent =
	/** `customerWaiting`: a customer's message opened it (an issue a member opened on a team message waits for no reply). */
	| {
			readonly _tag: "Opened"
			readonly at: number
			readonly priority: SlaPriority
			readonly customerWaiting: boolean
	  }
	| { readonly _tag: "CustomerMessage"; readonly at: number }
	| { readonly _tag: "TeamReply"; readonly at: number }
	| { readonly _tag: "Status"; readonly at: number; readonly status: SlaIssueStatus }
	| { readonly _tag: "Priority"; readonly at: number; readonly priority: SlaPriority }

export interface SlaContext {
	readonly targets: SlaTargets
	readonly calendar: SlaCalendar
	readonly warnBeforePct: number
}

const pausing = (status: SlaIssueStatus) => status === "waiting_on_customer" || status === "on_hold"

const startReply = (ctx: SlaContext, priority: SlaPriority, at: number, first: boolean): ReplyClock => {
	const targetMs = ctx.targets[priority].firstResponseMinutes * MINUTE
	return {
		first,
		startedAt: at,
		dueAt: addWorkingTime(ctx.calendar, at, targetMs),
		warnAt: addWorkingTime(ctx.calendar, at, targetMs * (1 - ctx.warnBeforePct / 100)),
		metAt: null,
		stoppedAt: null,
		elapsedMs: null,
		warnedAt: null,
		breachedAt: null,
	}
}

/** Re-derive a running reply clock's deadlines (a priority change); flags clear when the deadline moved past now. */
const retargetReply = (ctx: SlaContext, clock: ReplyClock, priority: SlaPriority, at: number): ReplyClock => {
	const next = startReply(ctx, priority, clock.startedAt, clock.first)
	return {
		...next,
		warnedAt: next.warnAt > at ? null : clock.warnedAt,
		breachedAt: next.dueAt > at ? null : clock.breachedAt,
	}
}

/** A running resolution clock's deadlines from what is left of its target. */
const resolutionDeadlines = (
	ctx: SlaContext,
	priority: SlaPriority,
	runningSince: number,
	consumedMs: number,
): { readonly dueAt: number; readonly warnAt: number } => {
	const targetMs = ctx.targets[priority].resolutionMinutes * MINUTE
	const warnMs = targetMs * (1 - ctx.warnBeforePct / 100)
	return {
		dueAt: addWorkingTime(ctx.calendar, runningSince, Math.max(0, targetMs - consumedMs)),
		warnAt: addWorkingTime(ctx.calendar, runningSince, Math.max(0, warnMs - consumedMs)),
	}
}

const running = (clock: ResolutionClock) => clock.runningSince !== null

/**
 * A running resolution clock's new deadlines, keeping a warning or breach already sent while the
 * target is used up: with nothing left, the deadline is the next working minute, which may lie ahead.
 */
const rederived = (
	ctx: SlaContext,
	clock: ResolutionClock,
	priority: SlaPriority,
	at: number,
	consumedMs: number,
): ResolutionClock => {
	const targetMs = ctx.targets[priority].resolutionMinutes * MINUTE
	const deadlines = resolutionDeadlines(ctx, priority, at, consumedMs)
	const warnPassed = consumedMs >= targetMs * (1 - ctx.warnBeforePct / 100) || deadlines.warnAt <= at
	const duePassed = consumedMs >= targetMs || deadlines.dueAt <= at
	return {
		...clock,
		runningSince: at,
		consumedMs,
		...deadlines,
		warnedAt: warnPassed ? clock.warnedAt : null,
		breachedAt: duePassed ? clock.breachedAt : null,
	}
}

const pauseResolution = (ctx: SlaContext, clock: ResolutionClock, at: number): ResolutionClock =>
	clock.runningSince === null
		? clock
		: {
				...clock,
				consumedMs: clock.consumedMs + workingTimeBetween(ctx.calendar, clock.runningSince, at),
				runningSince: null,
				dueAt: null,
				warnAt: null,
				pausedAt: at,
			}

const resumeResolution = (
	ctx: SlaContext,
	clock: ResolutionClock,
	priority: SlaPriority,
	at: number,
): ResolutionClock => {
	if (running(clock)) return clock
	return { ...rederived(ctx, clock, priority, at, clock.consumedMs), pausedAt: null, resolvedAt: null }
}

const isOpen = (clock: ReplyClock | null): clock is ReplyClock =>
	clock !== null && clock.metAt === null && clock.stoppedAt === null

/** The state of a new issue. */
export const openSla = (
	ctx: SlaContext,
	priority: SlaPriority,
	at: number,
	customerWaiting = true,
): SlaState => ({
	priority,
	reply: customerWaiting ? startReply(ctx, priority, at, true) : null,
	firstResponse: null,
	resolution: {
		runningSince: at,
		consumedMs: 0,
		...resolutionDeadlines(ctx, priority, at, 0),
		pausedAt: null,
		resolvedAt: null,
		warnedAt: null,
		breachedAt: null,
	},
})

/** Fold one issue event into its SLA state. */
export const stepSla = (ctx: SlaContext, state: SlaState, event: SlaEvent): SlaState => {
	const at = event.at
	switch (event._tag) {
		case "Opened":
			return openSla(ctx, event.priority, at, event.customerWaiting)
		case "TeamReply": {
			// `isOpen` narrows a met or stopped clock away; keep the stored one for the late-delivery case.
			const current: ReplyClock | null = state.reply
			// A reply sent before the running clock started (delivered late) does not answer it.
			if (!isOpen(state.reply) || at < state.reply.startedAt) {
				// A late delivery of an earlier reply moves the first response back.
				const first = state.firstResponse
				if (first === null || first.metAt === null || at >= first.metAt || at < first.startedAt)
					return state
				const earlier = {
					...first,
					metAt: at,
					elapsedMs: workingTimeBetween(ctx.calendar, first.startedAt, at),
				}
				return {
					...state,
					firstResponse: earlier,
					reply: current?.first === true ? earlier : current,
				}
			}
			const met: ReplyClock = {
				...state.reply,
				metAt: at,
				elapsedMs: workingTimeBetween(ctx.calendar, state.reply.startedAt, at),
			}
			return { ...state, reply: met, firstResponse: met.first ? met : state.firstResponse }
		}
		case "CustomerMessage": {
			// Delivered late: written before the last reply or the close, it was already answered.
			if (at < (state.reply?.metAt ?? -Infinity) || at < (state.resolution.resolvedAt ?? -Infinity))
				return state
			// The customer is waiting again: a reply is due (unless one already is), and a paused or
			// closed issue's resolution clock runs again.
			// The first customer message of an issue a member opened is its first response's start.
			const first = state.reply === null && state.firstResponse === null
			const reply = isOpen(state.reply) ? state.reply : startReply(ctx, state.priority, at, first)
			return {
				...state,
				reply,
				resolution: resumeResolution(ctx, state.resolution, state.priority, at),
			}
		}
		case "Status": {
			if (event.status === "closed") {
				const paused = pauseResolution(ctx, state.resolution, at)
				const reply = isOpen(state.reply) ? { ...state.reply, stoppedAt: at } : state.reply
				return {
					...state,
					reply,
					resolution: { ...paused, pausedAt: null, resolvedAt: state.resolution.resolvedAt ?? at },
				}
			}
			if (pausing(event.status))
				return { ...state, resolution: pauseResolution(ctx, state.resolution, at) }
			return { ...state, resolution: resumeResolution(ctx, state.resolution, state.priority, at) }
		}
		case "Priority": {
			if (event.priority === state.priority) return state
			const reply = isOpen(state.reply)
				? retargetReply(ctx, state.reply, event.priority, at)
				: state.reply
			const clock = state.resolution
			const resolution =
				clock.runningSince === null
					? clock
					: rederived(
							ctx,
							clock,
							event.priority,
							at,
							clock.consumedMs + workingTimeBetween(ctx.calendar, clock.runningSince, at),
						)
			return { ...state, priority: event.priority, reply, resolution }
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Deadlines the object's alarm acts on

export type SlaClockKey = "reply" | "resolution"
export type SlaAlert = {
	readonly clock: SlaClockKey
	readonly kind: "warning" | "breach"
	readonly at: number
}

/** Warnings and breaches due at or before `now` that are not yet recorded, in time order. */
export const dueAlerts = (state: SlaState, now: number): ReadonlyArray<SlaAlert> => {
	const alerts: Array<SlaAlert> = []
	const reply = state.reply
	if (isOpen(reply)) {
		if (reply.breachedAt === null && reply.dueAt <= now)
			alerts.push({ clock: "reply", kind: "breach", at: reply.dueAt })
		else if (reply.warnedAt === null && reply.warnAt <= now && reply.warnAt < reply.dueAt)
			alerts.push({ clock: "reply", kind: "warning", at: reply.warnAt })
	}
	const resolution = state.resolution
	if (resolution.dueAt !== null && resolution.warnAt !== null) {
		if (resolution.breachedAt === null && resolution.dueAt <= now)
			alerts.push({ clock: "resolution", kind: "breach", at: resolution.dueAt })
		else if (
			resolution.warnedAt === null &&
			resolution.warnAt <= now &&
			resolution.warnAt < resolution.dueAt
		)
			alerts.push({ clock: "resolution", kind: "warning", at: resolution.warnAt })
	}
	return alerts.slice().sort((a, b) => a.at - b.at)
}

/** Record alerts as sent (a breach also counts as its warning). */
export const markAlerts = (state: SlaState, alerts: ReadonlyArray<SlaAlert>, now: number): SlaState =>
	alerts.reduce<SlaState>((next, alert) => {
		if (alert.clock === "reply" && next.reply !== null) {
			const reply =
				alert.kind === "breach"
					? { ...next.reply, breachedAt: now, warnedAt: next.reply.warnedAt ?? now }
					: { ...next.reply, warnedAt: now }
			return { ...next, reply }
		}
		if (alert.clock === "resolution") {
			const resolution =
				alert.kind === "breach"
					? { ...next.resolution, breachedAt: now, warnedAt: next.resolution.warnedAt ?? now }
					: { ...next.resolution, warnedAt: now }
			return { ...next, resolution }
		}
		return next
	}, state)

/** The next instant the alarm must look at this issue (an unsent warning or breach); none when idle. */
export const nextAlertAt = (state: SlaState): number | null => {
	const candidates: Array<number> = []
	const reply = state.reply
	if (isOpen(reply)) {
		if (reply.warnedAt === null && reply.warnAt < reply.dueAt) candidates.push(reply.warnAt)
		else if (reply.breachedAt === null) candidates.push(reply.dueAt)
	}
	const resolution = state.resolution
	if (resolution.dueAt !== null && resolution.warnAt !== null) {
		if (resolution.warnedAt === null && resolution.warnAt < resolution.dueAt)
			candidates.push(resolution.warnAt)
		else if (resolution.breachedAt === null) candidates.push(resolution.dueAt)
	}
	return candidates.length === 0 ? null : Math.min(...candidates)
}

// ---------------------------------------------------------------------------------------------
// What a chip shows

export type SlaDisplay =
	| { readonly _tag: "None" }
	| { readonly _tag: "OnTime"; readonly clock: SlaClockKey; readonly dueAt: number }
	| { readonly _tag: "DueSoon"; readonly clock: SlaClockKey; readonly dueAt: number }
	| { readonly _tag: "Breached"; readonly clock: SlaClockKey; readonly dueAt: number }
	| { readonly _tag: "Paused"; readonly leftMs: number }
	| {
			readonly _tag: "Met"
			readonly clock: SlaClockKey
			readonly elapsedMs: number
			readonly onTime: boolean
	  }

const liveOf = (clock: SlaClockKey, dueAt: number, warnAt: number, now: number): SlaDisplay =>
	now >= dueAt
		? { _tag: "Breached", clock, dueAt }
		: now >= warnAt
			? { _tag: "DueSoon", clock, dueAt }
			: { _tag: "OnTime", clock, dueAt }

/**
 * The one state an issue's chip shows at `now`: a reply due wins (the customer is waiting), then a
 * running resolution, then a paused one; a resolved issue shows its first response.
 */
export const slaDisplay = (state: SlaState, targets: SlaTargets, now: number): SlaDisplay => {
	const reply = state.reply
	if (isOpen(reply)) return liveOf("reply", reply.dueAt, reply.warnAt, now)
	const resolution = state.resolution
	if (resolution.dueAt !== null && resolution.warnAt !== null)
		return liveOf("resolution", resolution.dueAt, resolution.warnAt, now)
	if (resolution.resolvedAt === null)
		return {
			_tag: "Paused",
			leftMs: Math.max(0, targets[state.priority].resolutionMinutes * MINUTE - resolution.consumedMs),
		}
	const first = state.firstResponse
	return first?.elapsedMs != null && first.metAt !== null
		? { _tag: "Met", clock: "reply", elapsedMs: first.elapsedMs, onTime: first.metAt <= first.dueAt }
		: { _tag: "None" }
}

// ---------------------------------------------------------------------------------------------
// Reports

/** The `q` quantile (0–1) of `values`, nearest-rank; null when empty. */
export const quantile = (values: ReadonlyArray<number>, q: number): number | null => {
	if (values.length === 0) return null
	const sorted = values.slice().sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? null
}

/** An issue's reported outcome: first response and resolution, each in working time and on time or not. */
export interface SlaOutcome {
	readonly firstResponseMs: number | null
	readonly firstResponseOnTime: boolean | null
	readonly resolutionMs: number | null
	readonly resolutionOnTime: boolean | null
}

export const outcomeOf = (state: SlaState, targets: SlaTargets): SlaOutcome => {
	const first = state.firstResponse
	const resolution = state.resolution
	const resolved = resolution.resolvedAt !== null && resolution.runningSince === null
	return {
		firstResponseMs: first?.elapsedMs ?? null,
		firstResponseOnTime: first?.metAt == null ? null : first.metAt <= first.dueAt,
		resolutionMs: resolved ? resolution.consumedMs : null,
		resolutionOnTime: resolved
			? resolution.consumedMs <= targets[state.priority].resolutionMinutes * MINUTE
			: null,
	}
}

// ---------------------------------------------------------------------------------------------
// The support report (`customers.support.report`)

const Ms = Schema.NullOr(Schema.Finite)
const Share = Schema.NullOr(Schema.Finite)

export const ClockStats = Schema.Struct({
	/** Issues with this clock finished (answered / resolved). */
	count: Schema.Int,
	medianMs: Ms,
	p90Ms: Ms,
	/** Share of `count` within target, 0–1. */
	withinPct: Share,
})
export type ClockStats = typeof ClockStats.Type

export const SupportReportRow = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	issues: Schema.Int,
	firstResponse: ClockStats,
	resolution: ClockStats,
	breaches: Schema.Int,
})
export type SupportReportRow = typeof SupportReportRow.Type

export const SupportReport = Schema.Struct({
	/** Issues opened in the range under an SLA. */
	issues: Schema.Int,
	firstResponse: ClockStats,
	resolution: ClockStats,
	/** Issues that missed a target (answered or resolved late, or overdue now). */
	breaches: Schema.Int,
	/** Overdue right now, opened in the range or not. */
	overdueNow: Schema.Int,
	byAccount: Schema.Array(SupportReportRow),
	byPolicy: Schema.Array(SupportReportRow),
	/** Per day of the range (UTC, `YYYY-MM-DD`), oldest first. */
	daily: Schema.Array(
		Schema.Struct({
			day: Schema.String,
			issues: Schema.Int,
			firstResponseMedianMs: Ms,
			withinPct: Share,
		}),
	),
})
export type SupportReport = typeof SupportReport.Type

export interface SupportReportInput {
	readonly issueId: string
	readonly accountId: string
	readonly accountName: string
	readonly policyName: string
	readonly openedAt: number
	readonly targets: SlaTargets
	readonly state: SlaState
}

const DAY_MS = 24 * 60 * 60_000

const statsOf = (outcomes: ReadonlyArray<{ readonly ms: number; readonly onTime: boolean }>): ClockStats => ({
	count: outcomes.length,
	medianMs: quantile(
		outcomes.map((outcome) => outcome.ms),
		0.5,
	),
	p90Ms: quantile(
		outcomes.map((outcome) => outcome.ms),
		0.9,
	),
	withinPct:
		outcomes.length === 0 ? null : outcomes.filter((outcome) => outcome.onTime).length / outcomes.length,
})

/** Whether a clock is past its deadline at `now` (overdue, not yet answered or resolved). */
export const isOverdue = (state: SlaState, now: number): boolean =>
	(isOpen(state.reply) && now >= state.reply.dueAt) ||
	(state.resolution.dueAt !== null && now >= state.resolution.dueAt)

/** First response and resolution in working time, on time or not, for the issues opened in `[from, now]`. */
export const supportReport = (
	rows: ReadonlyArray<SupportReportInput>,
	from: number,
	now: number,
): SupportReport => {
	const inRange = rows.filter((row) => row.openedAt >= from && row.openedAt <= now)
	const summarize = (group: ReadonlyArray<SupportReportInput>) => {
		const outcomes = group.map((row) => ({ row, outcome: outcomeOf(row.state, row.targets) }))
		const first = outcomes.flatMap(({ outcome }) =>
			outcome.firstResponseMs === null || outcome.firstResponseOnTime === null
				? []
				: [{ ms: outcome.firstResponseMs, onTime: outcome.firstResponseOnTime }],
		)
		const resolution = outcomes.flatMap(({ outcome }) =>
			outcome.resolutionMs === null || outcome.resolutionOnTime === null
				? []
				: [{ ms: outcome.resolutionMs, onTime: outcome.resolutionOnTime }],
		)
		const breaches = outcomes.filter(
			({ row, outcome }) =>
				outcome.firstResponseOnTime === false ||
				outcome.resolutionOnTime === false ||
				isOverdue(row.state, now),
		).length
		return {
			issues: group.length,
			firstResponse: statsOf(first),
			resolution: statsOf(resolution),
			breaches,
		}
	}
	const groupBy = (
		key: (row: SupportReportInput) => string,
		label: (row: SupportReportInput) => string,
	) => {
		const groups = new Map<string, Array<SupportReportInput>>()
		for (const row of inRange) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
		return [...groups.entries()]
			.map(([groupKey, group]) => ({
				key: groupKey,
				label: group[0] === undefined ? groupKey : label(group[0]),
				...summarize(group),
			}))
			.sort((a, b) => b.breaches - a.breaches || b.issues - a.issues || a.label.localeCompare(b.label))
	}
	const days: Array<SupportReport["daily"][number]> = []
	for (let start = Math.floor(from / DAY_MS) * DAY_MS; start <= now; start += DAY_MS) {
		const day = inRange.filter((row) => row.openedAt >= start && row.openedAt < start + DAY_MS)
		const stats = summarize(day)
		days.push({
			day: new Date(start).toISOString().slice(0, 10),
			issues: day.length,
			firstResponseMedianMs: stats.firstResponse.medianMs,
			withinPct: stats.firstResponse.withinPct,
		})
	}
	return {
		...summarize(inRange),
		overdueNow: rows.filter((row) => isOverdue(row.state, now)).length,
		byAccount: groupBy(
			(row) => row.accountId,
			(row) => row.accountName,
		),
		byPolicy: groupBy(
			(row) => row.policyName,
			(row) => row.policyName,
		),
		daily: days,
	}
}
