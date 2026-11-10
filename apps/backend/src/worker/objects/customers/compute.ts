/**
 * The compute pipeline of a `CustomersObject` (`docs/customers/tech-design.md` §4), run by its
 * alarm hourly and soon after changes (`./schedule.ts`):
 *
 * 1. rollups: each account's denormalized fields, and today's MRR movement;
 * 2. health: today's score and breakdown (`customer_health_daily`), band-change events;
 * 3. signals: every enabled rule × every account, through the lifecycle (open, refresh, wake,
 *    reopen, resolve; baseline mode after a backfill);
 * 4. counters: open signals per account, matches per rule;
 * 5. the org's day (`customer_org_daily`), and after a backfill the last year of history.
 *
 * Per-account built-in series are not stored daily: they derive from their sources at read time
 * (active users from activity, MRR from movements, health from `customer_health_daily`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { type Day, type HealthBreakdown, TEMPLATES } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId, CustomerSignalId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { evaluate, type Match } from "./evaluate"
import { type HealthInputs, scoreHealth } from "./health"
import { type LifecycleEvent, transition, valueOf, wakeDue } from "./lifecycle"
import {
	baselinePending,
	clearBaseline,
	clearHistoryRebuild,
	COMPUTE_INTERVAL_MS,
	historyRebuildPending,
	scheduleComputeAt,
} from "./schedule"
import { type AccountSnapshot, loadSnapshot, type Rollup, type Snapshot } from "./snapshot"
import { rowsPerInsert } from "./sql"
import { addDays, dayOf, dayRange, daysBetween } from "./time"

/** Account rows written per transaction. */
const CHUNK = 500
/** Days of history a rebuild covers. */
export const HISTORY_DAYS = 365

const chunks = <A>(items: ReadonlyArray<A>, size = CHUNK) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	)

const same = (a: unknown, b: unknown) =>
	a instanceof Date || b instanceof Date
		? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
		: JSON.stringify(a) === JSON.stringify(b)

/** The fields of `next` that differ from `current`. */
const diff = <A extends object>(current: A, next: Partial<A>): Partial<A> =>
	Object.fromEntries(
		Object.entries(next).filter(
			([key, value]) => !same((current as Record<string, unknown>)[key], value),
		),
	) as Partial<A>

const movementType = (from: number, to: number, everPaid: boolean) =>
	from === 0
		? everPaid
			? "reactivation"
			: "new"
		: to === 0
			? "churn"
			: to > from
				? "expansion"
				: "contraction"

const hazelEvent = (
	accountId: CustomerAccountId,
	type: string,
	title: string,
	occurredAt: Date,
	data: Record<string, unknown>,
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.customerEventsTable).values({
				accountId,
				provider: "hazel",
				type,
				title,
				data,
				occurredAt,
			}),
		),
	)

// ---------------------------------------------------------------------------
// 1. Rollups
// ---------------------------------------------------------------------------

/** Today's movement: merged with an earlier one of the same day, removed when MRR is back. */
const writeMovement = (account: schema.CustomerAccount, rollup: Rollup, today: Day) =>
	Effect.gen(function* () {
		if (account.mrrMinor === rollup.mrrMinor) return
		const db = yield* Database.Database
		const existing = yield* db.first(
			SQLite.from(schema.customerMrrMovementsTable)
				.select()
				.where(($) => [$.accountId.eq(account.id), $.day.eq(today)])
				.limit(1),
		)
		const from = Option.match(existing, {
			onNone: () => account.mrrMinor,
			onSome: (row) => row.fromMrrMinor,
		})
		yield* db.run(
			SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [
				$.accountId.eq(account.id),
				$.day.eq(today),
			]),
		)
		if (from === rollup.mrrMinor) return
		yield* db.run(
			SQLite.insertInto(schema.customerMrrMovementsTable).values({
				accountId: account.id,
				day: today,
				type: movementType(
					from,
					rollup.mrrMinor,
					account.customerSince !== null && account.churnedAt !== null,
				),
				deltaMinor: rollup.mrrMinor - from,
				fromMrrMinor: from,
				toMrrMinor: rollup.mrrMinor,
				currency: rollup.currency,
			}),
		)
	})

const writeRollups = (snapshot: Snapshot) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { now, today } = snapshot.org
		for (const chunk of chunks(snapshot.accounts)) {
			yield* db.transaction(
				Effect.forEach(
					chunk,
					({ stored, rollup }) =>
						Effect.gen(function* () {
							yield* writeMovement(stored, rollup, today)
							const changes = diff(stored, rollup)
							if (Object.keys(changes).length === 0) return
							yield* db.run(
								SQLite.update(schema.customerAccountsTable)
									.set({ ...changes, updatedAt: now } as never)
									.where(($) => [$.id.eq(stored.id)]),
							)
						}),
					{ discard: true },
				),
			)
		}
	})

// ---------------------------------------------------------------------------
// 2. Health
// ---------------------------------------------------------------------------

type RiskCounts = { high: number; medium: number; low: number }

const openRiskOf = (snapshot: Snapshot) => {
	const excluded = new Set(snapshot.health.excludedTemplates)
	const counts = new Map<CustomerAccountId, RiskCounts>()
	for (const signal of snapshot.signals) {
		if (signal.kind !== "risk" || excluded.has(signal.template)) continue
		if (signal.status !== "open" && signal.status !== "snoozed") continue
		const current = counts.get(signal.accountId) ?? { high: 0, medium: 0, low: 0 }
		current[signal.severity]++
		counts.set(signal.accountId, current)
	}
	return counts
}

export const healthInputsOf = (
	snapshot: Snapshot,
	account: AccountSnapshot,
	openRisk: RiskCounts | undefined,
): HealthInputs => {
	const { facts, rollup } = account
	const { now, today } = snapshot.org
	const live = facts.subscriptions.filter((sub) => sub.status !== "canceled")
	const overdue = facts.openInvoices.filter((invoice) => invoice.dueAt !== null && invoice.dueAt < now)
	const weekAgo = now.getTime() - 7 * 86_400_000
	return {
		churned: rollup.lifecycleStage === "churned",
		hasActivityData: snapshot.hasActivityData,
		contactCount: rollup.contactCount,
		activeUsers30d: rollup.activeUsers30d,
		trendPct: rollup.activeUsersTrendPct,
		daysSinceActive: facts.lastActiveDay === null ? null : daysBetween(facts.lastActiveDay, today),
		billing:
			snapshot.hasBillingData && live.length > 0
				? {
						pastDue: live.some((sub) => sub.status === "past_due" || sub.status === "unpaid"),
						overdueOverWeek: overdue.some((invoice) => invoice.dueAt!.getTime() < weekAgo),
						overdue: overdue.length > 0,
						cancelScheduled: live.some((sub) => sub.cancelAtPeriodEnd),
					}
				: null,
		openRisk: openRisk ?? { high: 0, medium: 0, low: 0 },
	}
}

/** Score every account (pure): what compute writes and the health dry run compares. */
export const scoreAll = (snapshot: Snapshot, settings = snapshot.health) => {
	const openRisk = openRiskOf(snapshot)
	return new Map(
		snapshot.accounts.map((account) => [
			account.stored.id,
			scoreHealth(healthInputsOf(snapshot, account, openRisk.get(account.stored.id)), { ...settings }),
		]),
	)
}

const STATUS_LABEL = { healthy: "Healthy", at_risk: "At risk", critical: "Critical", unknown: "Unknown" }

const writeHealth = (snapshot: Snapshot, scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { now, today } = snapshot.org
		for (const chunk of chunks(snapshot.accounts)) {
			yield* db.transaction(
				Effect.forEach(
					chunk,
					({ stored }) =>
						Effect.gen(function* () {
							const breakdown = scores.get(stored.id)!
							yield* db.run(
								SQLite.insertInto(schema.customerHealthDailyTable)
									.values({
										accountId: stored.id,
										day: today,
										score: breakdown.score,
										status: breakdown.status,
										breakdown,
									})
									.onConflictDoUpdate({
										target: ["accountId", "day"],
										set: { score: breakdown.score, status: breakdown.status, breakdown },
									}),
							)
							if (
								stored.healthScore === breakdown.score &&
								stored.healthStatus === breakdown.status
							)
								return
							yield* db.run(
								SQLite.update(schema.customerAccountsTable)
									.set({
										healthScore: breakdown.score,
										healthStatus: breakdown.status,
										healthUpdatedAt: now,
										updatedAt: now,
									})
									.where(($) => [$.id.eq(stored.id)]),
							)
							if (
								stored.healthStatus !== "unknown" &&
								breakdown.status !== "unknown" &&
								stored.healthStatus !== breakdown.status
							) {
								yield* hazelEvent(
									stored.id,
									"health.status_changed",
									`Health ${STATUS_LABEL[stored.healthStatus]} → ${STATUS_LABEL[breakdown.status]}`,
									now,
									{
										from: stored.healthStatus,
										to: breakdown.status,
										fromScore: stored.healthScore,
										toScore: breakdown.score,
									},
								)
							}
						}),
					{ discard: true },
				),
			)
		}
	})

/** The facts with today's health in place, for `health_drop`. */
const withTodayHealth = (
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
): Snapshot => ({
	...snapshot,
	accounts: snapshot.accounts.map((account) => {
		const breakdown = scores.get(account.stored.id)!
		return {
			...account,
			facts: {
				...account.facts,
				account: {
					...account.facts.account,
					healthScore: breakdown.score,
					healthStatus: breakdown.status,
				},
				health: [
					...account.facts.health.filter((point) => point.day !== snapshot.org.today),
					{ day: snapshot.org.today, score: breakdown.score, status: breakdown.status },
				],
			},
		}
	}),
})

// ---------------------------------------------------------------------------
// 3–4. Signals and counters
// ---------------------------------------------------------------------------

const EVENT_TITLE: Record<LifecycleEvent["type"], string> = {
	"signal.opened": "Signal",
	"signal.resolved": "Resolved",
	"signal.woke": "Snooze ended",
	"signal.reopened": "Reopened",
}

/** The unclosed signals after this run: `ruleId:accountId` → its status and severity. */
type Live = Map<string, Pick<schema.CustomerSignal, "status" | "severity" | "kind" | "accountId">>

const writeSignals = (snapshot: Snapshot) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { now } = snapshot.org
		const baseline = yield* baselinePending
		const unclosed = new Map(
			snapshot.signals.map((signal) => [`${signal.ruleId}:${signal.accountId}`, signal]),
		)
		const live: Live = new Map(
			snapshot.signals.map((signal) => [`${signal.ruleId}:${signal.accountId}`, signal]),
		)
		const matches = new Map<string, number>()
		const triggered = new Set<string>()

		for (const rule of snapshot.rules) {
			const template = TEMPLATES[rule.template]
			const ruleBaseline = baseline && template.baselineOnBackfill
			for (const chunk of chunks(snapshot.accounts)) {
				yield* db.transaction(
					Effect.forEach(
						chunk,
						({ stored, facts }) =>
							Effect.gen(function* () {
								const key = `${rule.id}:${stored.id}`
								const result = evaluate(rule, facts, snapshot.org)
								const match: Match | null = result._tag === "Match" ? result : null
								if (match !== null) matches.set(rule.id, (matches.get(rule.id) ?? 0) + 1)
								const signal = unclosed.get(key) ?? null
								const step = transition(signal, match, {
									now,
									baseline: ruleBaseline,
									valueMinor: valueOf(facts.account),
								})
								if (step._tag === "Keep") return
								let signalId: CustomerSignalId
								let title: string
								if (step._tag === "Insert") {
									const evidence = match!.evidence
									const [row] = yield* db.run(
										SQLite.insertInto(schema.customerSignalsTable)
											.values({
												organizationId: stored.organizationId,
												accountId: stored.id,
												ruleId: rule.id,
												template: rule.template,
												kind: rule.kind,
												severity: match!.severity,
												status: step.status,
												title: match!.title,
												reason: match!.reason,
												evidence,
												openingEvidence: evidence,
												actionEvidence: step.status === "dismissed" ? evidence : null,
												dismissReason:
													step.status === "dismissed" ? "baseline" : null,
												priorityScore: step.priorityScore,
												firstDetectedAt: now,
												openedAt: now,
												lastEvaluatedAt: now,
											})
											.returning("id"),
									)
									signalId = row!.id
									title = match!.title
									live.set(key, {
										status: step.status,
										severity: match!.severity,
										kind: rule.kind,
										accountId: stored.id,
									})
									if (step.status === "open") triggered.add(rule.id)
								} else {
									signalId = signal!.id
									title = step.patch.title ?? signal!.title
									yield* db.run(
										SQLite.update(schema.customerSignalsTable)
											.set({ ...step.patch, updatedAt: now })
											.where(($) => [$.id.eq(signal!.id)]),
									)
									if (step.patch.closedAt != null) live.delete(key)
									else {
										live.set(key, {
											status: step.patch.status ?? signal!.status,
											severity: step.patch.severity ?? signal!.severity,
											kind: signal!.kind,
											accountId: stored.id,
										})
									}
									if (step.patch.status === "open" && signal!.status !== "snoozed")
										triggered.add(rule.id)
								}
								if (step.event !== null) {
									yield* hazelEvent(
										stored.id,
										step.event.type,
										`${EVENT_TITLE[step.event.type]}: ${title}`,
										now,
										{
											signalId,
											ruleId: rule.id,
											template: rule.template,
											severity: match?.severity ?? signal?.severity ?? rule.severity,
											...(match === null ? {} : { reason: match.reason }),
											...step.event.data,
										},
									)
								}
							}),
						{ discard: true },
					),
				)
			}
		}
		if (baseline) yield* clearBaseline

		// Counters: unresolved (open or snoozed) signals per account; matches per rule.
		const counts = new Map<
			CustomerAccountId,
			{ openRiskHigh: number; openRiskMedium: number; openRiskLow: number; openOpportunities: number }
		>()
		for (const signal of live.values()) {
			if (signal.status !== "open" && signal.status !== "snoozed") continue
			const current = counts.get(signal.accountId) ?? {
				openRiskHigh: 0,
				openRiskMedium: 0,
				openRiskLow: 0,
				openOpportunities: 0,
			}
			if (signal.kind === "opportunity") current.openOpportunities++
			else if (signal.severity === "high") current.openRiskHigh++
			else if (signal.severity === "medium") current.openRiskMedium++
			else current.openRiskLow++
			counts.set(signal.accountId, current)
		}
		for (const chunk of chunks(snapshot.accounts)) {
			yield* db.transaction(
				Effect.forEach(
					chunk,
					({ stored }) => {
						const changes = diff(
							stored,
							counts.get(stored.id) ?? {
								openRiskHigh: 0,
								openRiskMedium: 0,
								openRiskLow: 0,
								openOpportunities: 0,
							},
						)
						return Object.keys(changes).length === 0
							? Effect.void
							: db.run(
									SQLite.update(schema.customerAccountsTable)
										.set({ ...changes, updatedAt: now })
										.where(($) => [$.id.eq(stored.id)]),
								)
					},
					{ discard: true },
				),
			)
		}
		yield* db.transaction(
			Effect.forEach(
				snapshot.rules,
				(rule) => {
					const changes = diff(rule, {
						matchingCount: matches.get(rule.id) ?? 0,
						...(triggered.has(rule.id) ? { lastTriggeredAt: now } : {}),
					})
					return Object.keys(changes).length === 0
						? Effect.void
						: db.run(
								SQLite.update(schema.customerSignalRulesTable)
									.set({ ...changes, updatedAt: now })
									.where(($) => [$.id.eq(rule.id)]),
							)
				},
				{ discard: true },
			),
		)
		return live
	})

// ---------------------------------------------------------------------------
// 5. The org's day, and history
// ---------------------------------------------------------------------------

/** Distinct contacts active on each day's last 1, 7 and 30 days. */
const activeUsersByDay = (
	rows: ReadonlyArray<{ readonly contactId: string; readonly day: Day }>,
	days: ReadonlyArray<Day>,
) => {
	const byDay = new Map<Day, Array<string>>()
	for (const row of rows) {
		const list = byDay.get(row.day)
		if (list === undefined) byDay.set(row.day, [row.contactId])
		else list.push(row.contactId)
	}
	const distinct = (from: Day, to: Day) => {
		const set = new Set<string>()
		for (let day = from; day <= to; day = addDays(day, 1))
			for (const contact of byDay.get(day) ?? []) set.add(contact)
		return set.size
	}
	return new Map(
		days.map((day) => [
			day,
			{
				dau: byDay.get(day)?.length ?? 0,
				wau: distinct(addDays(day, -6), day),
				mau: distinct(addDays(day, -29), day),
			},
		]),
	)
}

const writeOrgDay = (
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
	live: Live,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { today } = snapshot.org
		const users = activeUsersByDay(snapshot.activityRows, [today]).get(today)!
		const highRisk = new Set(
			[...live.values()]
				.filter(
					(signal) =>
						signal.kind === "risk" &&
						signal.severity === "high" &&
						(signal.status === "open" || signal.status === "snoozed"),
				)
				.map((signal) => signal.accountId),
		)
		const statuses = [...scores.values()].map((breakdown) => breakdown.status)
		const values = {
			mrrMinor: snapshot.accounts.reduce((sum, account) => sum + account.rollup.mrrMinor, 0),
			payingAccounts: snapshot.accounts.filter((account) => account.rollup.mrrMinor > 0).length,
			trialingAccounts: snapshot.accounts.filter(
				(account) => account.rollup.lifecycleStage === "trialing",
			).length,
			activeAccounts: snapshot.accounts.filter((account) => account.rollup.activeUsers30d > 0).length,
			dau: users.dau,
			wau: users.wau,
			mau: users.mau,
			healthy: statuses.filter((status) => status === "healthy").length,
			atRisk: statuses.filter((status) => status === "at_risk").length,
			critical: statuses.filter((status) => status === "critical").length,
			atRiskMrrMinor: snapshot.accounts
				.filter((account) => highRisk.has(account.stored.id))
				.reduce((sum, account) => sum + account.rollup.mrrMinor, 0),
		}
		yield* db.run(
			SQLite.insertInto(schema.customerOrgDailyTable)
				.values({ day: today, ...values })
				.onConflictDoUpdate({ target: ["day"], set: values }),
		)
	})

/** An account's MRR per day from its subscriptions' paid periods (trials and cancellations end them). */
export const mrrHistory = (
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	currency: string,
	days: ReadonlyArray<Day>,
): Array<number> => {
	const periods = subscriptions
		.filter(
			(sub) =>
				sub.currency === currency &&
				sub.mrrMinor > 0 &&
				sub.status !== "trialing" &&
				sub.status !== "paused",
		)
		.flatMap((sub) => {
			const start = sub.trialEndsAt ?? sub.startedAt
			if (start === null) return []
			if (sub.status === "canceled" && sub.canceledAt === null) return []
			return [
				{
					from: dayOf(start),
					until: sub.canceledAt === null ? null : dayOf(sub.canceledAt),
					mrr: sub.mrrMinor,
				},
			]
		})
	return days.map((day) =>
		periods.reduce(
			(sum, period) =>
				day >= period.from && (period.until === null || day < period.until) ? sum + period.mrr : sum,
			0,
		),
	)
}

/**
 * The last year rebuilt from the sources (after a backfill or the demo seed): every account's MRR
 * movements, and the org's daily rows (MRR, paying, trialing, active, DAU/WAU/MAU, health counts).
 */
export const rebuildHistory = Effect.fn("Customers.rebuildHistory")(function* (snapshot: Snapshot) {
	const db = yield* Database.Database
	const { today } = snapshot.org
	const days = dayRange(today, HISTORY_DAYS + 1)
	const first = days[0]!
	const before = addDays(first, -1)
	const currency = snapshot.org.currency
	const accountMrr = new Map<CustomerAccountId, Array<number>>()
	const movements: Array<schema.CustomerMrrMovement extends infer _ ? Record<string, unknown> : never> = []
	for (const { stored, facts } of snapshot.accounts) {
		const series = mrrHistory(facts.subscriptions, currency, [before, ...days])
		accountMrr.set(stored.id, series.slice(1))
		let everPaid = false
		for (let index = 1; index < series.length; index++) {
			const from = series[index - 1]!
			const to = series[index]!
			if (from > 0) everPaid = true
			if (from === to) continue
			movements.push({
				accountId: stored.id,
				day: days[index - 1]!,
				type: movementType(from, to, everPaid),
				deltaMinor: to - from,
				fromMrrMinor: from,
				toMrrMinor: to,
				currency,
			})
		}
	}
	const trialingOn = (day: Day) =>
		snapshot.accounts.filter(({ facts }) =>
			facts.subscriptions.some(
				(sub) =>
					sub.trialEndsAt !== null &&
					sub.startedAt !== null &&
					dayOf(sub.startedAt) <= day &&
					day < dayOf(sub.trialEndsAt) &&
					(sub.canceledAt === null || day < dayOf(sub.canceledAt)),
			),
		).length
	const activity = (yield* db.query(
		Database.sql`SELECT "accountId", "contactId", "day" FROM "customer_activity_daily"
			WHERE "day" >= ${addDays(first, -29)} AND ("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`,
	)) as ReadonlyArray<{ accountId: CustomerAccountId; contactId: CustomerContactId; day: Day }>
	const users = activeUsersByDay(activity, days)
	const accountDays = new Map<Day, Set<CustomerAccountId>>()
	for (const row of activity) {
		const set = accountDays.get(row.day) ?? new Set()
		set.add(row.accountId)
		accountDays.set(row.day, set)
	}
	const health = (yield* db.query(
		Database.sql`SELECT "day", "status", count(*) AS "count" FROM "customer_health_daily"
			WHERE "day" >= ${first} GROUP BY "day", "status"`,
	)) as ReadonlyArray<{ day: Day; status: string; count: number }>
	const healthOf = (day: Day, status: string) =>
		Number(health.find((row) => row.day === day && row.status === status)?.count ?? 0)
	const orgDays = days.map((day, index) => {
		const active = new Set<CustomerAccountId>()
		for (let back = 0; back < 30; back++)
			for (const id of accountDays.get(addDays(day, -back)) ?? []) active.add(id)
		const mrrs = [...accountMrr.values()].map((series) => series[index]!)
		return {
			day,
			mrrMinor: mrrs.reduce((sum, value) => sum + value, 0),
			payingAccounts: mrrs.filter((value) => value > 0).length,
			trialingAccounts: trialingOn(day),
			activeAccounts: active.size,
			...users.get(day)!,
			healthy: healthOf(day, "healthy"),
			atRisk: healthOf(day, "at_risk"),
			critical: healthOf(day, "critical"),
			atRiskMrrMinor: 0,
		}
	})
	yield* db.transaction(
		Effect.gen(function* () {
			yield* db.run(
				SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [$.day.gte(first)]),
			)
			for (const chunk of chunks(movements, rowsPerInsert(7))) {
				yield* db.run(SQLite.insertInto(schema.customerMrrMovementsTable).values(chunk as never))
			}
			// Today's row is written by the compute that follows, with its at-risk MRR.
			yield* db.run(
				SQLite.deleteFrom(schema.customerOrgDailyTable).where(($) => [
					$.day.gte(first),
					$.day.lt(today),
				]),
			)
			for (const chunk of chunks(
				orgDays.filter((row) => row.day < today),
				rowsPerInsert(12),
			)) {
				yield* db.run(SQLite.insertInto(schema.customerOrgDailyTable).values(chunk))
			}
		}),
	)
	yield* Effect.annotateCurrentSpan({ "customers.movements": movements.length })
})

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export const runCompute = Effect.fn("Customers.compute")(function* (now: Date) {
	const db = yield* Database.Database
	if (yield* historyRebuildPending) {
		yield* rebuildHistory(yield* loadSnapshot(now))
		yield* clearHistoryRebuild
	}
	const snapshot = yield* loadSnapshot(now)
	yield* writeRollups(snapshot)
	const scores = scoreAll(snapshot)
	yield* writeHealth(snapshot, scores)
	const live = yield* writeSignals(withTodayHealth(snapshot, scores))
	yield* writeOrgDay(snapshot, scores, live)
	yield* db.run(
		SQLite.update(schema.customerSettingsTable)
			.set({ lastComputedAt: now, updatedAt: now })
			.where(($) => [$.id.eq(snapshot.settings.id)]),
	)
	yield* scheduleComputeAt(now.getTime() + COMPUTE_INTERVAL_MS)
	yield* Effect.annotateCurrentSpan({
		"customers.accounts": snapshot.accounts.length,
		"customers.rules": snapshot.rules.length,
	})
})

/** Snoozes that ended open again (between computes). */
export const wakeSnoozed = Effect.fn("Customers.wakeSnoozed")(function* (now: Date) {
	const db = yield* Database.Database
	const due = (yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select()
			.where(($) => [$.status.eq("snoozed"), $.closedAt.isNull(), $.snoozedUntil.lte(now)]),
	)).filter((signal) => wakeDue(signal, now))
	for (const signal of due) {
		yield* db.run(
			SQLite.update(schema.customerSignalsTable)
				.set({ status: "open", snoozedUntil: null, updatedAt: now })
				.where(($) => [$.id.eq(signal.id)]),
		)
		yield* hazelEvent(signal.accountId, "signal.woke", `Snooze ended: ${signal.title}`, now, {
			signalId: signal.id,
			ruleId: signal.ruleId,
			template: signal.template,
			severity: signal.severity,
			early: false,
		})
	}
	return due.length
})
