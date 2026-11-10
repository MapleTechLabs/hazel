/**
 * The compute pipeline of a `CustomersObject` (`docs/customers/tech-design.md` §4), run by its
 * alarm hourly and soon after changes (`./schedule.ts`):
 *
 * 1. rollups: each account's denormalized fields, and today's MRR movement;
 * 2. health: today's score and breakdown (`customer_health_daily`), band-change events;
 * 3. signals: every enabled rule × every account, through the lifecycle (open, refresh, wake,
 *    reopen, resolve; baseline mode after a backfill);
 * 4. counters: open signals per account, matches per rule;
 * 5. the org's day (`customer_org_daily`, and yesterday's user counts again);
 * 6. once a day, retention: old daily rows, events, closed signals and sync runs are deleted.
 *
 * After a connection's first backfill, an alarm turn of its own (`runComputeStep`) rebuilds the last
 * year of history where none is recorded, once no billing backfill is importing.
 *
 * Accounts are processed in chunks (`ACCOUNT_CHUNK`, `./snapshot.ts`): steps 1–4 run per chunk, so
 * memory holds one chunk's activity and signals; the org's distinct user counts come from SQL.
 *
 * Per-account built-in series are not stored daily: they derive from their sources at read time
 * (active users from activity, MRR from movements, health from `customer_health_daily`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type CustomerProvider,
	type Day,
	type HealthBreakdown,
	type HealthSettings,
	type SignalTemplate,
	TEMPLATES,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerSignalId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { evaluate, type Match } from "./evaluate"
import { type HealthInputs, scoreHealth } from "./health"
import { type LifecycleEvent, transition, valueOf, wakeDue } from "./lifecycle"
import {
	baselineConnections,
	clearBaseline,
	clearHistoryRebuild,
	COMPUTE_DEBOUNCE_MS,
	COMPUTE_INTERVAL_MS,
	historyRebuildPending,
	nextReopenAt,
	resetComputeFailures,
	scheduleComputeAt,
} from "./schedule"
import {
	ACTIVE,
	type AccountSnapshot,
	accountChunks,
	loadAccounts,
	loadBase,
	type Rollup,
	type Snapshot,
	type SnapshotBase,
} from "./snapshot"
import { inList, rowsPerInsert } from "./sql"
import { addDays, DAY_MS, dayOf, dayRange, daysBetween } from "./time"

/** Days of history a rebuild covers. */
export const HISTORY_DAYS = 365
/** A backfill run older than this, or whose connection failed this often in a row, is not importing. */
const BACKFILL_MAX_AGE_MS = 24 * 60 * 60_000
const BACKFILL_MAX_FAILURES = 3
/** A source disconnected this long is gone for good: the signals that need it close. */
const GONE_AFTER_MS = 14 * DAY_MS
/** Retention (`prune`). */
const DAILY_RETENTION_DAYS = 400
const EVENT_RETENTION_MS = 730 * DAY_MS
const CLOSED_SIGNAL_RETENTION_MS = 180 * DAY_MS
const SYNC_RUN_RETENTION_MS = 30 * DAY_MS

/** Meta: the billing provider MRR was last computed from (a switch writes no movements). */
const MRR_SOURCE_KEY = "mrrSource"
const PRUNED_KEY = "prunedOn"

const meta = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
	effect.pipe(Effect.mapError(Database.toDatabaseError))

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

/**
 * `holdMovements`: the MRR change is not revenue, so no movement is written: MRR now comes from
 * another billing provider than last run, a billing backfill is still importing (its accounts'
 * history comes from the rebuild after it), or that rebuild is pending. Neither does a change of
 * reporting currency.
 */
const writeRollups = Effect.fn("Customers.writeRollups")(function* (
	snapshot: Snapshot,
	holdMovements: boolean,
) {
	const db = yield* Database.Database
	const { now, today } = snapshot.org
	yield* db.transaction(
		Effect.forEach(
			snapshot.accounts,
			({ stored, rollup }) =>
				Effect.gen(function* () {
					if (!holdMovements && stored.currency === rollup.currency)
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
})

// ---------------------------------------------------------------------------
// 2. Health
// ---------------------------------------------------------------------------

type RiskCounts = { high: number; medium: number; low: number }

const openRiskOf = (snapshot: Snapshot, settings: HealthSettings) => {
	const excluded = new Set(settings.excludedTemplates)
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
	/** The due dates of the overdue invoices. */
	const overdue = facts.openInvoices.flatMap((invoice) =>
		invoice.dueAt !== null && invoice.dueAt < now ? [invoice.dueAt] : [],
	)
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
						overdueOverWeek: overdue.some((dueAt) => dueAt.getTime() < weekAgo),
						overdue: overdue.length > 0,
						cancelScheduled: live.some((sub) => sub.cancelAtPeriodEnd),
					}
				: null,
		openRisk: openRisk ?? { high: 0, medium: 0, low: 0 },
	}
}

/** Score the snapshot's accounts (pure): what compute writes and the health dry run compares. */
export const scoreAll = (snapshot: Snapshot, settings = snapshot.health) => {
	const openRisk = openRiskOf(snapshot, settings)
	return new Map(
		snapshot.accounts.map((account) => [
			account.stored.id,
			scoreHealth(healthInputsOf(snapshot, account, openRisk.get(account.stored.id)), { ...settings }),
		]),
	)
}

const STATUS_LABEL = { healthy: "Healthy", at_risk: "At risk", critical: "Critical", unknown: "Unknown" }

const writeHealth = Effect.fn("Customers.writeHealth")(function* (
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
) {
	const db = yield* Database.Database
	const { now, today } = snapshot.org
	yield* db.transaction(
		Effect.forEach(
			snapshot.accounts,
			({ stored }) =>
				Effect.gen(function* () {
					const breakdown = scores.get(stored.id)
					// `scoreAll` scores every account of the snapshot.
					if (breakdown === undefined) return
					// Unchanged since the last run today: no write (and no change row to sync).
					if (!same(snapshot.todayHealth.get(stored.id) ?? null, breakdown))
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
									set: {
										score: breakdown.score,
										status: breakdown.status,
										breakdown,
									},
								}),
						)
					if (stored.healthScore === breakdown.score && stored.healthStatus === breakdown.status)
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
})

/** The facts with today's health in place, for `health_drop`. */
const withTodayHealth = (
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
): Snapshot => ({
	...snapshot,
	accounts: snapshot.accounts.map((account) => {
		const breakdown = scores.get(account.stored.id)
		// `scoreAll` scores every account of the snapshot.
		if (breakdown === undefined) return account
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

const EVENT_TITLE = {
	"signal.opened": "Signal",
	"signal.resolved": "Resolved",
	"signal.woke": "Snooze ended",
	"signal.reopened": "Reopened",
} satisfies Record<LifecycleEvent["type"], string>

/** A chunk's unclosed signals after this run: `ruleId:accountId` → its status and severity. */
type Live = Map<string, Pick<schema.CustomerSignal, "status" | "severity" | "kind" | "accountId">>

/** One compute's signal evaluation, across the account chunks. */
interface SignalRun {
	/** Providers whose import is news to no one (§4.7): their templates run in baseline mode. */
	readonly baseline: ReadonlySet<CustomerProvider>
	readonly armed: boolean
	/** Providers disconnected for over `GONE_AFTER_MS`: the signals of their templates close. */
	readonly gone: ReadonlySet<CustomerProvider>
	readonly matches: Map<string, number>
	readonly triggered: Set<string>
	readonly counts: { opened: number; baselined: number; updated: number; events: number; orphaned: number }
}

/** The providers still importing a backfill (younger than a day, and not failing over and over). */
const importingProviders = (now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const rows = yield* db.run(
			SQLite.from(schema.customerSyncRunsTable, "r")
				.innerJoin(schema.customerConnectionsTable, "c", (r, c) =>
					SQLite.and(
						c.id.eq(r.connectionId),
						c.status.eq("active"),
						c.consecutiveFailures.lt(BACKFILL_MAX_FAILURES),
					),
				)
				.select(($) => ({ provider: $.provider }))
				.where(($) => [
					$.status.eq("running"),
					$.trigger.eq("backfill"),
					$.startedAt.gte(new Date(now.getTime() - BACKFILL_MAX_AGE_MS)),
				]),
		)
		return new Set(rows.map((row) => row.provider))
	})

/** A billing source is still importing: MRR is partial, its history not rebuilt yet. */
const billingImporting = (importing: ReadonlySet<CustomerProvider>) =>
	importing.has("stripe") || importing.has("autumn")

/**
 * The providers in baseline mode: those whose backfill finished since the last compute
 * (`baselineFor`), and those still importing one (`importingProviders`: a stuck import must not
 * silence the queue for good).
 */
const baselineProviders = (importing: ReadonlySet<CustomerProvider>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const armed = yield* baselineConnections
		const finished =
			armed.length === 0
				? []
				: yield* db.run(
						SQLite.from(schema.customerConnectionsTable)
							.select("provider")
							.where(($) => [$.status.eq("active"), inList($.id, armed)]),
					)
		return {
			armed: armed.length > 0,
			providers: new Set([...finished.map((row) => row.provider), ...importing]),
		}
	})

/** A template is in baseline mode when one of its sources (any, for a source-less one) is. */
const inBaseline = (template: SignalTemplate, providers: ReadonlySet<CustomerProvider>) => {
	const { baselineOnBackfill, requiredSources } = TEMPLATES[template]
	if (!baselineOnBackfill || providers.size === 0) return false
	return requiredSources.length === 0 || requiredSources.some((provider) => providers.has(provider))
}

const startSignals = (now: Date, importing: ReadonlySet<CustomerProvider>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const baseline = yield* baselineProviders(importing)
		const gone = yield* db.run(
			SQLite.from(schema.customerConnectionsTable)
				.select("provider")
				.where(($) => [
					$.status.eq("disconnected"),
					$.disconnectedAt.lt(new Date(now.getTime() - GONE_AFTER_MS)),
				]),
		)
		return {
			baseline: baseline.providers,
			armed: baseline.armed,
			gone: new Set(gone.map((row) => row.provider)),
			matches: new Map(),
			triggered: new Set(),
			counts: { opened: 0, baselined: 0, updated: 0, events: 0, orphaned: 0 },
		} satisfies SignalRun
	})

const ZERO_COUNTERS = { openRiskHigh: 0, openRiskMedium: 0, openRiskLow: 0, openOpportunities: 0 }

/** A signal's source is gone for good: it closes (resolved, when still in the queue). */
const closedForGood = (signal: Pick<schema.CustomerSignal, "status">, now: Date) =>
	signal.status === "open" || signal.status === "snoozed"
		? { status: "auto_resolved" as const, resolvedAt: now, closedAt: now, lastEvaluatedAt: now }
		: { closedAt: now, lastEvaluatedAt: now }

/**
 * Every rule against the chunk's accounts, then their counters (their signals are final). Returns
 * the chunk's unclosed signals.
 */
const writeSignals = Effect.fn("Customers.writeSignals")(function* (snapshot: Snapshot, run: SignalRun) {
	const db = yield* Database.Database
	const { now } = snapshot.org
	const { matches, triggered, counts } = run
	const unclosed = new Map(
		snapshot.signals.map((signal) => [`${signal.ruleId}:${signal.accountId}`, signal]),
	)
	const live: Live = new Map(unclosed)

	for (const rule of snapshot.rules) {
		const ruleBaseline = inBaseline(rule.template, run.baseline)
		const sourceGone = TEMPLATES[rule.template].requiredSources.some((provider) => run.gone.has(provider))
		yield* db.transaction(
			Effect.forEach(
				snapshot.accounts,
				({ stored, facts }) =>
					Effect.gen(function* () {
						const key = `${rule.id}:${stored.id}`
						const result = evaluate(rule, facts, snapshot.org)
						const signal = unclosed.get(key) ?? null
						// Its source is unavailable (in error, disconnected): what people did with the signal
						// stays as it is, and nothing new opens until the source is back; disconnected for
						// good, the signal closes.
						if (result._tag === "NoMatch" && result.reason === "Missing data source") {
							if (!sourceGone || signal === null) return
							counts.updated++
							live.delete(key)
							yield* db.run(
								SQLite.update(schema.customerSignalsTable)
									.set({ ...closedForGood(signal, now), updatedAt: now })
									.where(($) => [$.id.eq(signal.id)]),
							)
							return
						}
						const match: Match | null = result._tag === "Match" ? result : null
						if (match !== null) matches.set(rule.id, (matches.get(rule.id) ?? 0) + 1)
						const step = transition(signal, match, {
							now,
							baseline: ruleBaseline,
							valueMinor: valueOf(facts.account),
						})
						if (step._tag === "Keep") return
						let signalId: CustomerSignalId
						let title: string
						if (step._tag === "Insert") {
							// `transition` inserts only on a match.
							if (match === null) return
							const evidence = match.evidence
							const [row] = yield* db.run(
								SQLite.insertInto(schema.customerSignalsTable)
									.values({
										organizationId: stored.organizationId,
										accountId: stored.id,
										ruleId: rule.id,
										template: rule.template,
										kind: rule.kind,
										severity: match.severity,
										status: step.status,
										title: match.title,
										reason: match.reason,
										evidence,
										openingEvidence: evidence,
										actionEvidence: step.status === "dismissed" ? evidence : null,
										dismissReason: step.status === "dismissed" ? "baseline" : null,
										priorityScore: step.priorityScore,
										firstDetectedAt: now,
										openedAt: now,
										lastEvaluatedAt: now,
									})
									.returning("id"),
							)
							signalId = row.id
							title = match.title
							if (step.status === "open") counts.opened++
							else counts.baselined++
							live.set(key, {
								status: step.status,
								severity: match.severity,
								kind: rule.kind,
								accountId: stored.id,
							})
							if (step.status === "open") triggered.add(rule.id)
						} else {
							// …and updates only an unclosed signal.
							if (signal === null) return
							signalId = signal.id
							title = step.patch.title ?? signal.title
							counts.updated++
							yield* db.run(
								SQLite.update(schema.customerSignalsTable)
									.set({ ...step.patch, updatedAt: now })
									.where(($) => [$.id.eq(signal.id)]),
							)
							if (step.patch.closedAt != null) live.delete(key)
							else {
								live.set(key, {
									status: step.patch.status ?? signal.status,
									severity: step.patch.severity ?? signal.severity,
									kind: signal.kind,
									accountId: stored.id,
								})
							}
							if (step.patch.status === "open" && signal.status !== "snoozed")
								triggered.add(rule.id)
						}
						if (step.event !== null) {
							counts.events++
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
									// Left out of the stored JSON when there is no match.
									reason: match?.reason,
									...step.event.data,
								},
							)
						}
					}),
				{ discard: true },
			),
		)
	}

	// Counters: unresolved (open or snoozed) signals per account.
	const perAccount = new Map<CustomerAccountId, typeof ZERO_COUNTERS>()
	for (const signal of live.values()) {
		if (signal.status !== "open" && signal.status !== "snoozed") continue
		const current = perAccount.get(signal.accountId) ?? { ...ZERO_COUNTERS }
		if (signal.kind === "opportunity") current.openOpportunities++
		else if (signal.severity === "high") current.openRiskHigh++
		else if (signal.severity === "medium") current.openRiskMedium++
		else current.openRiskLow++
		perAccount.set(signal.accountId, current)
	}
	yield* db.transaction(
		Effect.forEach(
			snapshot.accounts,
			({ stored }) => {
				const changes = diff(stored, perAccount.get(stored.id) ?? ZERO_COUNTERS)
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
	return live
})

/** After every chunk: deleted accounts' signals closed, matches per rule, the baseline disarmed. */
const finishSignals = Effect.fn("Customers.finishSignals")(function* (
	now: Date,
	rules: SnapshotBase["rules"],
	run: SignalRun,
) {
	const db = yield* Database.Database
	const { matches, triggered, counts } = run
	if (run.armed) yield* clearBaseline

	// Signals of deleted accounts: closed (an account no longer evaluated never resolves them).
	const orphans = (yield* db.query(
		Database.sql`SELECT "id", "status" FROM "customer_signals" WHERE "closedAt" IS NULL
			AND "accountId" NOT IN (SELECT "id" FROM "customer_accounts" WHERE "deletedAt" IS NULL)`,
	)) as ReadonlyArray<Pick<schema.CustomerSignal, "id" | "status">>
	for (const chunk of accountChunks(orphans)) {
		yield* db.transaction(
			Effect.forEach(
				chunk,
				(signal) =>
					db.run(
						SQLite.update(schema.customerSignalsTable)
							.set({ ...closedForGood(signal, now), updatedAt: now })
							.where(($) => [$.id.eq(signal.id)]),
					),
				{ discard: true },
			),
		)
	}
	counts.orphaned = orphans.length

	yield* db.transaction(
		Effect.forEach(
			rules,
			(rule) => {
				const matchingCount = matches.get(rule.id) ?? 0
				const changes = diff(
					rule,
					triggered.has(rule.id) ? { matchingCount, lastTriggeredAt: now } : { matchingCount },
				)
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
	yield* Effect.annotateCurrentSpan({
		"customers.baseline_providers": [...run.baseline].join(","),
		"customers.signals_opened": counts.opened,
		"customers.signals_baselined": counts.baselined,
		"customers.signals_updated": counts.updated,
		"customers.signal_events": counts.events,
		"customers.signals_orphaned": counts.orphaned,
	})
})

// ---------------------------------------------------------------------------
// 5. The org's day, and history
// ---------------------------------------------------------------------------

/** Rows of `activeCounts`' gap queries: `n` keys active on `day`, next active `gap` days later (≤ 30). */
type Gaps = ReadonlyArray<{ readonly day: Day; readonly gap: number; readonly n: number }>

/**
 * For a day of `[from, to]`: distinct contacts active that day (DAU), in its last 7 (WAU) and 30
 * (MAU) days, and accounts with activity in its last 30 days. Each key's active day counts for the
 * days up to its next one (at most the window), so SQL returns a few rows per day, never the
 * activity itself.
 */
const activeCounts = Effect.fn("Customers.activeCounts")(function* (from: Day, to: Day) {
	const db = yield* Database.Database
	const start = addDays(from, -29)
	const where = Database.sql`"day" >= ${start} AND "day" <= ${to} AND ${ACTIVE}
		AND "accountId" IN (SELECT "id" FROM "customer_accounts" WHERE "deletedAt" IS NULL)`
	const gap = Database.sql`min(coalesce(CAST(julianday("next") - julianday("day") AS INTEGER), 30), 30)`
	const contacts = (yield* db.query(
		Database.sql`SELECT "day", ${gap} AS "gap", count(*) AS "n" FROM (
			SELECT "day", LEAD("day") OVER (PARTITION BY "contactId" ORDER BY "day") AS "next"
			FROM "customer_activity_daily" WHERE ${where}
		) GROUP BY 1, 2`,
	)) as Gaps
	const accounts = (yield* db.query(
		Database.sql`SELECT "day", ${gap} AS "gap", count(*) AS "n" FROM (
			SELECT "day", LEAD("day") OVER (PARTITION BY "accountId" ORDER BY "day") AS "next"
			FROM (SELECT DISTINCT "accountId", "day" FROM "customer_activity_daily" WHERE ${where})
		) GROUP BY 1, 2`,
	)) as Gaps
	const span = daysBetween(start, to) + 1
	const cover = (rows: Gaps, window: number) => {
		const counts = Array.from({ length: span }, () => 0)
		for (const row of rows) {
			const at = daysBetween(start, row.day)
			for (let offset = 0; offset < Math.min(Number(row.gap), window) && at + offset < span; offset++)
				counts[at + offset] += Number(row.n)
		}
		return counts
	}
	const [dau, wau, mau, active] = [
		cover(contacts, 1),
		cover(contacts, 7),
		cover(contacts, 30),
		cover(accounts, 30),
	]
	// A day outside `[start, to]` counts nothing.
	return (day: Day) => {
		const index = daysBetween(start, day)
		return {
			dau: dau[index] ?? 0,
			wau: wau[index] ?? 0,
			mau: mau[index] ?? 0,
			activeAccounts: active[index] ?? 0,
		}
	}
})

/** The org's totals over the chunks, for today's row. */
interface OrgTotals {
	mrrMinor: number
	payingAccounts: number
	trialingAccounts: number
	healthy: number
	atRisk: number
	critical: number
	/** Σ MRR of the accounts with an open (or snoozed) high risk signal. */
	atRiskMrrMinor: number
}

const addTotals = (
	totals: OrgTotals,
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
	live: Live,
) => {
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
	for (const { stored, rollup } of snapshot.accounts) {
		totals.mrrMinor += rollup.mrrMinor
		if (rollup.mrrMinor > 0) totals.payingAccounts++
		if (rollup.lifecycleStage === "trialing") totals.trialingAccounts++
		if (highRisk.has(stored.id)) totals.atRiskMrrMinor += rollup.mrrMinor
		const status = scores.get(stored.id)?.status
		if (status === "healthy") totals.healthy++
		else if (status === "at_risk") totals.atRisk++
		else if (status === "critical") totals.critical++
	}
}

const writeOrgDay = (base: SnapshotBase, totals: OrgTotals) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const { today } = base.org
		const yesterday = addDays(today, -1)
		const users = yield* activeCounts(yesterday, today)
		const values = { ...totals, ...users(today) }
		yield* db.run(
			SQLite.insertInto(schema.customerOrgDailyTable)
				.values({ day: today, ...values })
				.onConflictDoUpdate({ target: ["day"], set: values }),
		)
		// Yesterday's activity keeps arriving after midnight: its row's user counts are redone.
		const stored = yield* db.first(
			SQLite.from(schema.customerOrgDailyTable)
				.select()
				.where(($) => [$.day.eq(yesterday)])
				.limit(1),
		)
		if (Option.isNone(stored)) return
		const changes = diff(stored.value, users(yesterday))
		if (Object.keys(changes).length === 0) return
		yield* db.run(
			SQLite.update(schema.customerOrgDailyTable)
				.set(changes)
				.where(($) => [$.day.eq(yesterday)]),
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
					// An active subscription may carry the date it is scheduled to cancel on.
					until:
						sub.status === "canceled" && sub.canceledAt !== null ? dayOf(sub.canceledAt) : null,
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
 * The last year rebuilt from the sources (after a connection's first backfill or the demo seed):
 * MRR movements of the accounts without any yet (their MRR set to where the movements end, in the
 * same transaction, so a crash before the rollups cannot count them twice), and the org's daily
 * rows (MRR, paying, trialing, active, DAU/WAU/MAU, health counts) for the days without one; a day
 * recorded before billing data existed (no MRR, no paying account) gets its billing columns.
 */
export const rebuildHistory = Effect.fn("Customers.rebuildHistory")(function* (base: SnapshotBase) {
	const db = yield* Database.Database
	const { today, currency } = base.org
	const days = dayRange(today, HISTORY_DAYS + 1)
	const first = days[0]
	const before = addDays(first, -1)
	const live = new Set(base.accountIds)
	const accounts = (yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "mrrMinor")
			.where(($) => [$.deletedAt.isNull()]),
	)).filter((account) => live.has(account.id))
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [$.provider.eq(base.billingProvider)]),
	)
	const subsBy = new Map<CustomerAccountId, Array<schema.CustomerSubscription>>()
	for (const sub of subscriptions) {
		const list = subsBy.get(sub.accountId)
		if (list === undefined) subsBy.set(sub.accountId, [sub])
		else list.push(sub)
	}
	const withMovements = new Set(
		(
			(yield* db.query(
				Database.sql`SELECT DISTINCT "accountId" FROM "customer_mrr_movements"`,
			)) as ReadonlyArray<{ accountId: CustomerAccountId }>
		).map((row) => row.accountId),
	)
	const mrr = Array.from({ length: days.length }, () => 0)
	const paying = Array.from({ length: days.length }, () => 0)
	const trialing = Array.from({ length: days.length }, () => 0)
	const movements: Array<Record<string, unknown>> = []
	const mrrNow: Array<{ id: CustomerAccountId; mrrMinor: number }> = []
	for (const account of accounts) {
		const subs = subsBy.get(account.id) ?? []
		const series = mrrHistory(subs, currency, [before, ...days])
		const trial = new Uint8Array(days.length)
		for (const sub of subs) {
			if (sub.trialEndsAt === null || sub.startedAt === null) continue
			const end =
				sub.canceledAt !== null && sub.canceledAt < sub.trialEndsAt ? sub.canceledAt : sub.trialEndsAt
			const from = Math.max(0, daysBetween(first, dayOf(sub.startedAt)))
			const until = Math.min(days.length, daysBetween(first, dayOf(end)))
			for (let index = from; index < until; index++) trial[index] = 1
		}
		for (let index = 0; index < days.length; index++) {
			mrr[index] += series[index + 1]
			if (series[index + 1] > 0) paying[index]++
			trialing[index] += trial[index]
		}
		if (withMovements.has(account.id)) continue
		let everPaid = false
		for (let index = 1; index < series.length; index++) {
			const from = series[index - 1]
			const to = series[index]
			if (from > 0) everPaid = true
			if (from === to) continue
			movements.push({
				accountId: account.id,
				day: days[index - 1],
				type: movementType(from, to, everPaid),
				deltaMinor: to - from,
				fromMrrMinor: from,
				toMrrMinor: to,
				currency,
			})
		}
		const current = series[series.length - 1]
		if (current !== account.mrrMinor) mrrNow.push({ id: account.id, mrrMinor: current })
	}
	const users = yield* activeCounts(first, today)
	const health = new Map(
		(
			(yield* db.query(
				Database.sql`SELECT "day", "status", count(*) AS "count" FROM "customer_health_daily"
				WHERE "day" >= ${first} GROUP BY "day", "status"`,
			)) as ReadonlyArray<{ day: Day; status: string; count: number }>
		).map((row) => [`${row.day}:${row.status}`, Number(row.count)]),
	)
	const healthOf = (day: Day, status: string) => health.get(`${day}:${status}`) ?? 0
	// Today's row is written by the compute that follows, with its at-risk MRR.
	const orgDays = days.flatMap((day, index) =>
		day < today
			? [
					{
						day,
						mrrMinor: mrr[index],
						payingAccounts: paying[index],
						trialingAccounts: trialing[index],
						...users(day),
						healthy: healthOf(day, "healthy"),
						atRisk: healthOf(day, "at_risk"),
						critical: healthOf(day, "critical"),
						atRiskMrrMinor: 0,
					},
				]
			: [],
	)
	const now = base.org.now
	yield* db.transaction(
		Effect.gen(function* () {
			for (const chunk of accountChunks(movements, rowsPerInsert(7))) {
				yield* db.run(SQLite.insertInto(schema.customerMrrMovementsTable).values(chunk as never))
			}
			for (const account of mrrNow) {
				yield* db.run(
					SQLite.update(schema.customerAccountsTable)
						.set({ mrrMinor: account.mrrMinor, updatedAt: now })
						.where(($) => [$.id.eq(account.id)]),
				)
			}
			// One statement, the days as one JSON parameter. Recorded days keep their values, except
			// billing columns still empty (recorded before any billing data came in).
			yield* db.query(
				Database.sql`INSERT INTO "customer_org_daily" ("day", "mrrMinor", "payingAccounts", "trialingAccounts",
					"activeAccounts", "dau", "wau", "mau", "healthy", "atRisk", "critical", "atRiskMrrMinor")
				SELECT json_extract(value, '$.day'), json_extract(value, '$.mrrMinor'),
					json_extract(value, '$.payingAccounts'), json_extract(value, '$.trialingAccounts'),
					json_extract(value, '$.activeAccounts'), json_extract(value, '$.dau'), json_extract(value, '$.wau'),
					json_extract(value, '$.mau'), json_extract(value, '$.healthy'), json_extract(value, '$.atRisk'),
					json_extract(value, '$.critical'), json_extract(value, '$.atRiskMrrMinor')
				FROM json_each(${JSON.stringify(orgDays)}) WHERE true
				ON CONFLICT ("day") DO UPDATE SET "mrrMinor" = excluded."mrrMinor",
					"payingAccounts" = excluded."payingAccounts", "trialingAccounts" = excluded."trialingAccounts"
				WHERE "customer_org_daily"."mrrMinor" = 0 AND "customer_org_daily"."payingAccounts" = 0`,
			)
		}),
	)
	yield* Effect.annotateCurrentSpan({
		"customers.movements": movements.length,
		"customers.rebuilt_accounts": mrrNow.length,
	})
})

// ---------------------------------------------------------------------------
// 6. Retention
// ---------------------------------------------------------------------------

/** Once a day: daily rows past 400 days, events past 2 years, closed signals and sync runs. */
const prune = Effect.fn("Customers.prune")(function* (now: Date) {
	const db = yield* Database.Database
	const today = dayOf(now)
	if (Option.getOrUndefined(yield* meta(readObjectMeta(PRUNED_KEY))) === today) return
	const oldest = addDays(today, -DAILY_RETENTION_DAYS)
	const ago = (ms: number) => new Date(now.getTime() - ms)
	yield* db.run(SQLite.deleteFrom(schema.customerHealthDailyTable).where(($) => [$.day.lt(oldest)]))
	yield* db.run(SQLite.deleteFrom(schema.customerActivityDailyTable).where(($) => [$.day.lt(oldest)]))
	yield* db.run(SQLite.deleteFrom(schema.customerMetricDailyTable).where(($) => [$.day.lt(oldest)]))
	yield* db.run(
		SQLite.deleteFrom(schema.customerEventsTable).where(($) => [
			$.occurredAt.lt(ago(EVENT_RETENTION_MS)),
		]),
	)
	yield* db.run(
		SQLite.deleteFrom(schema.customerSignalsTable).where(($) => [
			$.closedAt.lt(ago(CLOSED_SIGNAL_RETENTION_MS)),
		]),
	)
	yield* db.run(
		SQLite.deleteFrom(schema.customerSyncRunsTable).where(($) => [
			$.status.neq("running"),
			$.startedAt.lt(ago(SYNC_RUN_RETENTION_MS)),
		]),
	)
	yield* meta(writeObjectMeta(PRUNED_KEY, today))
})

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * One alarm turn's compute work: the history rebuild when one is pending and no billing backfill
 * is importing (alone in its turn, the compute right after), else the compute.
 */
export const runComputeStep = Effect.fn("Customers.computeStep")(function* (now: Date) {
	const importing = yield* importingProviders(now)
	if (!billingImporting(importing) && (yield* historyRebuildPending)) {
		yield* rebuildHistory(yield* loadBase(now))
		yield* clearHistoryRebuild
		yield* resetComputeFailures
		return yield* scheduleComputeAt(now.getTime())
	}
	yield* runCompute(now)
})

export const runCompute = Effect.fn("Customers.compute")(function* (now: Date) {
	const db = yield* Database.Database
	const base = yield* loadBase(now)
	const importing = yield* importingProviders(now)
	const source = yield* meta(readObjectMeta(MRR_SOURCE_KEY))
	const switched = Option.isSome(source) && source.value !== base.billingProvider
	const holdMovements = switched || billingImporting(importing) || (yield* historyRebuildPending)
	yield* Effect.annotateCurrentSpan({
		"customers.accounts": base.accountIds.length,
		"customers.rules": base.rules.length,
		"customers.billing_provider": base.billingProvider,
		"customers.mrr_source_switched": switched,
		"customers.movements_held": holdMovements,
	})
	const signals = yield* startSignals(now, importing)
	const totals: OrgTotals = {
		mrrMinor: 0,
		payingAccounts: 0,
		trialingAccounts: 0,
		healthy: 0,
		atRisk: 0,
		critical: 0,
		atRiskMrrMinor: 0,
	}
	for (const ids of accountChunks(base.accountIds)) {
		const snapshot = yield* loadAccounts(base, ids)
		yield* writeRollups(snapshot, holdMovements)
		const scores = scoreAll(snapshot)
		yield* writeHealth(snapshot, scores)
		const live = yield* writeSignals(withTodayHealth(snapshot, scores), signals)
		addTotals(totals, snapshot, scores, live)
	}
	yield* finishSignals(now, base.rules, signals)
	yield* writeOrgDay(base, totals)
	yield* meta(writeObjectMeta(MRR_SOURCE_KEY, base.billingProvider))
	yield* prune(now)
	yield* db.run(
		SQLite.update(schema.customerSettingsTable)
			.set({ lastComputedAt: now, updatedAt: now })
			.where(($) => [$.id.eq(base.settings.id)]),
	)
	yield* resetComputeFailures
	// Hourly, or sooner for a done signal's reopen check (never a hot loop on an overdue one).
	const reopen = yield* nextReopenAt
	const hourly = now.getTime() + COMPUTE_INTERVAL_MS
	yield* scheduleComputeAt(
		Option.match(reopen, {
			onNone: () => hourly,
			onSome: (at) => Math.min(hourly, Math.max(at, now.getTime() + COMPUTE_DEBOUNCE_MS)),
		}),
	)
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
