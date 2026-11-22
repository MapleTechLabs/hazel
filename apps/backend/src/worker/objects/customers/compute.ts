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
 * year of history where none is recorded, once no billing backfill is importing (given up after
 * `MAX_REBUILD_ATTEMPTS` failed attempts).
 *
 * Accounts are processed in chunks (`ACCOUNT_CHUNK`, `./snapshot.ts`): steps 1–4 run per chunk, so
 * memory holds one chunk's activity and signals; the org's distinct user counts come from SQL. A
 * compute past `COMPUTE_TURN_BUDGET_MS` or `MAX_CHUNKS_PER_TURN` stops after a chunk and continues
 * in the next alarm turn from where it stopped (`computeProgress`; started over when it is stale, or
 * the day or Autumn's readiness changed); step 4's rule counts, 5 and 6 run after the last chunk.
 *
 * Per-account built-in series are not stored daily: they derive from their sources at read time
 * (active users from activity, MRR from movements, health from `customer_health_daily`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type CustomerProvider,
	Day,
	type HealthBreakdown,
	type HealthSettings,
	type SignalTemplate,
	TEMPLATES,
} from "@hazel/domain/customers"
import { CustomerAccountId, type CustomerSignalId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { deleteObjectMeta, readObjectMeta, writeObjectMeta } from "../meta"
import { refreshSuggestionsAfterCompute } from "./channel-suggestions"
import { publishChannelCustomersAfterCompute } from "./channels"
import { evaluate, type Match } from "./evaluate"
import type { AccountFacts } from "./facts"
import { type HealthInputs, scoreHealth } from "./health"
import { type LifecycleEvent, limitSignalTarget, transition, valueOf, wakeDue } from "./lifecycle"
import {
	baselineConnections,
	clearBaselineFor,
	clearComputeProgress,
	clearHistoryRebuild,
	clearPayingRefresh,
	clearRevenueWalk,
	COMPUTE_DEBOUNCE_MS,
	COMPUTE_INTERVAL_MS,
	computeProgress,
	historyRebuildPending,
	payingRefreshPending,
	requestHistoryRebuild,
	resetComputeFailures,
	revenueWalk,
	saveComputeProgress,
	saveRevenueWalk,
	scheduleComputeAt,
	takeComputeAgain,
	takeRebuildAttempt,
} from "./schedule"
import {
	type AccountSnapshot,
	accountChunks,
	billingByAccount,
	billsNow,
	evaluatedFor,
	groupChunks,
	loadAccounts,
	loadBase,
	type Rollup,
	type Snapshot,
	type SnapshotBase,
} from "./snapshot"
import { pays } from "./facts"
import {
	type BilledInvoice,
	loadRevenueBasis,
	type RevenueBasis,
	recurringHistoryOf,
	type SubscriptionInvoice,
	type TrailingUsage,
	USAGE_LOOKBACK_MS,
	trailingUsageOf,
	windowMonths,
} from "./revenue"
import { inList, isActive, rowsPerInsert } from "./sql"
import { addDays, DAY_MS, dayOf, dayRange, daysBetween } from "./time"

/** Days of history a rebuild covers. */
export const HISTORY_DAYS = 365
/** A backfill run older than this is not importing any more (a stuck one must not hold compute for good). */
const BACKFILL_MAX_AGE_MS = 24 * 60 * 60_000
/** A history rebuild that failed this often is given up: computes go on without it. */
const MAX_REBUILD_ATTEMPTS = 3
/** A compute's alarm turn stops after the chunk that passes this; the next turn continues. */
const COMPUTE_TURN_BUDGET_MS = 10_000
/** …or after this many chunks, whatever the clock says (a Worker's clock may not advance while it computes). */
const MAX_CHUNKS_PER_TURN = 8
/** A compute spread over turns that started longer ago than this starts over (its totals are stale). */
const COMPUTE_PROGRESS_MAX_AGE_MS = 60 * 60_000
/** A source disconnected this long is gone for good: the signals that need it close. */
const GONE_AFTER_MS = 14 * DAY_MS
/** Retention (`prune`). */
const DAILY_RETENTION_DAYS = 400
const EVENT_RETENTION_MS = 730 * DAY_MS
const CLOSED_SIGNAL_RETENTION_MS = 180 * DAY_MS
const SYNC_RUN_RETENTION_MS = 30 * DAY_MS

const PRUNED_KEY = "prunedOn"
/** The revenue basis (`./revenue.ts`) the history was last restated under. */
const REVENUE_BASIS_KEY = "revenueBasis"
/** The next history rebuild restates the billing history (a new revenue basis), not only fills it in. */
const RESTATE_KEY = "restateRevenue"
/** The billing data's version: below {@link REVENUE_DATA_VERSION}, Stripe is walked again. */
const REVENUE_DATA_KEY = "revenueData"
/** 1: invoice lines and the price catalog (`docs/customers/revenue.md`). */
const REVENUE_DATA_VERSION = "1"
/** Set once the recorded days' user counts were redone from activity (rows written before it was backfilled). */
const USER_COUNTS_REDONE_KEY = "userCountsRedone"

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

/** Today's variable MRR change: merged with an earlier one of the same day, removed when it is back. */
const writeVariableChange = (account: schema.CustomerAccount, rollup: Rollup, today: Day) =>
	Effect.gen(function* () {
		if (account.variableMrrMinor === rollup.variableMrrMinor) return
		const db = yield* Database.Database
		const existing = yield* db.first(
			SQLite.from(schema.customerVariableMrrChangesTable)
				.select("fromMinor")
				.where(($) => [$.accountId.eq(account.id), $.day.eq(today)])
				.limit(1),
		)
		const from = Option.match(existing, {
			onNone: () => account.variableMrrMinor,
			onSome: (row) => row.fromMinor,
		})
		yield* db.run(
			SQLite.deleteFrom(schema.customerVariableMrrChangesTable).where(($) => [
				$.accountId.eq(account.id),
				$.day.eq(today),
			]),
		)
		if (from === rollup.variableMrrMinor) return
		yield* db.run(
			SQLite.insertInto(schema.customerVariableMrrChangesTable).values({
				accountId: account.id,
				day: today,
				fromMinor: from,
				toMinor: rollup.variableMrrMinor,
				currency: rollup.currency,
			}),
		)
	})

/** No MRR or variable MRR was ever computed for it: its first is revenue, under whatever basis. */
const neverBilled = (account: schema.CustomerAccount) =>
	account.mrrBasis === null && account.mrrMinor === 0 && account.variableMrrMinor === 0

/**
 * A payer moved to another billing provider than last run (`mrrSource`) that bills it now in the
 * reporting currency: a migration, not revenue, so its MRR change writes no movement. A move to a
 * source that does not bill (a churn), bills only in another currency (its MRR 0 here), or from
 * MRR 0 (an upgrade from a free plan), keeps its movement.
 */
const switchedSource = ({ stored, rollup, facts }: AccountSnapshot) =>
	stored.mrrSource !== null &&
	rollup.mrrSource !== stored.mrrSource &&
	stored.mrrMinor > 0 &&
	facts.subscriptions.some((sub) => billsNow(sub) && sub.currency === rollup.currency)

/** Its MRR comes, or came last run, from a billing provider still importing its backfill. */
const fromImporting = ({ stored, rollup }: AccountSnapshot, importing: ReadonlySet<CustomerProvider>) =>
	(stored.mrrSource !== null && importing.has(stored.mrrSource)) ||
	(rollup.mrrSource !== null && importing.has(rollup.mrrSource))

/**
 * An account's MRR change is not revenue, so no movement is written, when its MRR comes (or came)
 * from a billing backfill still importing (`fromImporting`: partial data, its history the rebuild's
 * after it), or while that rebuild is pending (`rebuildPending`: a movement would keep it from an
 * account without history). Other accounts' changes are revenue during another provider's import.
 * Neither does a payer whose MRR now comes from another billing provider that bills it
 * (`switchedSource`), nor a change of reporting currency or of revenue basis (`mrrBasis`: the
 * history rebuild restates it). The number of accounts that switched.
 */
const writeRollups = Effect.fn("Customers.writeRollups")(function* (
	snapshot: Snapshot,
	importing: ReadonlySet<CustomerProvider>,
	rebuildPending: boolean,
) {
	const db = yield* Database.Database
	const { now, today } = snapshot.org
	let switched = 0
	const stripeImporting = importing.has("stripe")
	// A rule can put usage in MRR, and invoices are Stripe's whichever source holds the plan.
	const usageCanBeMrr = snapshot.revenue.rules.some((rule) => rule.classification === "recurring")
	yield* db.transaction(
		Effect.forEach(
			snapshot.accounts,
			(account) =>
				Effect.gen(function* () {
					const { stored, rollup } = account
					const isSwitch = switchedSource(account)
					// While Stripe imports, a balance built on it is partial: it stays where its series ends,
					// and the first compute after the import records the whole change.
					const sameBasis = stored.mrrBasis === rollup.mrrBasis
					const holdsVariable = stripeImporting && sameBasis
					const holdsMrr =
						holdsVariable &&
						!isSwitch &&
						(usageCanBeMrr || stored.mrrSource === "stripe" || rollup.mrrSource === "stripe")
					if (isSwitch) switched++
					else if (
						!rebuildPending &&
						!fromImporting(account, importing) &&
						stored.currency === rollup.currency &&
						// Computed under other revenue rules: a reclassification, restated, not revenue.
						// One never billed has no basis to change from.
						(stored.mrrBasis === rollup.mrrBasis || neverBilled(stored))
					) {
						if (!holdsMrr) yield* writeMovement(stored, rollup, today)
						if (!holdsVariable) yield* writeVariableChange(stored, rollup, today)
					}
					const changes = diff(stored, {
						...rollup,
						mrrMinor: holdsMrr ? stored.mrrMinor : rollup.mrrMinor,
						variableMrrMinor: holdsVariable ? stored.variableMrrMinor : rollup.variableMrrMinor,
					})
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
	return switched
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
		customer: rollup.lifecycleStage !== "lead" && rollup.lifecycleStage !== "churned",
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

/** The facts with today's health in place, for `health_drop` (a group's are its primary's). */
const withTodayHealth = (
	snapshot: Snapshot,
	scores: ReadonlyMap<CustomerAccountId, HealthBreakdown>,
): Snapshot => ({
	...snapshot,
	accounts: snapshot.accounts.map((account) => {
		const breakdown = scores.get(account.stored.id)
		// `scoreAll` scores every account of the snapshot.
		if (breakdown === undefined) return account
		const scored = (facts: AccountFacts): AccountFacts => ({
			...facts,
			account: { ...facts.account, healthScore: breakdown.score, healthStatus: breakdown.status },
			health: [
				...facts.health.filter((point) => point.day !== snapshot.org.today),
				{ day: snapshot.org.today, score: breakdown.score, status: breakdown.status },
			],
		})
		const facts = scored(account.facts)
		return {
			...account,
			facts,
			evaluated:
				account.evaluated === null
					? null
					: account.evaluated === account.facts
						? facts
						: scored(account.evaluated),
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

/** One compute's signal evaluation, across the account chunks (and alarm turns). */
interface SignalRun {
	/** Providers whose import is news to no one (§4.7): their templates run in baseline mode. */
	readonly baseline: ReadonlySet<CustomerProvider>
	/** The connections whose finished backfill armed the baseline when the compute started. */
	readonly armed: ReadonlyArray<string>
	/** Providers disconnected for over `GONE_AFTER_MS`: the signals of their templates close. */
	readonly gone: ReadonlySet<CustomerProvider>
	readonly matches: Map<string, number>
	readonly triggered: Set<string>
	readonly counts: { opened: number; baselined: number; updated: number; events: number; orphaned: number }
}

/**
 * The providers still importing a backfill: a running one, younger than a day. Retryable failures
 * (rate limits, outages) keep the run running, so they do not end the import early.
 */
const importingProviders = (now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const rows = yield* db.run(
			SQLite.from(schema.customerSyncRunsTable, "r")
				.innerJoin(schema.customerConnectionsTable, "c", (r, c) =>
					SQLite.and(c.id.eq(r.connectionId), c.status.eq("active")),
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
const baselineProviders = (importing: ReadonlySet<CustomerProvider>, armed: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const finished =
			armed.length === 0
				? []
				: yield* db.run(
						SQLite.from(schema.customerConnectionsTable)
							.select("provider")
							.where(($) => [$.status.eq("active"), inList($.id, armed)]),
					)
		return new Set([...finished.map((row) => row.provider), ...importing])
	})

/** A template is in baseline mode when one of its sources (any, for a source-less one) is. */
const inBaseline = (template: SignalTemplate, providers: ReadonlySet<CustomerProvider>) => {
	const { baselineOnBackfill, requiredSources } = TEMPLATES[template]
	if (!baselineOnBackfill || providers.size === 0) return false
	return requiredSources.length === 0 || requiredSources.some((provider) => providers.has(provider))
}

const startSignals = (
	now: Date,
	importing: ReadonlySet<CustomerProvider>,
	resumed: Pick<SignalRun, "armed" | "matches" | "triggered">,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const gone = yield* db.run(
			SQLite.from(schema.customerConnectionsTable)
				.select("provider")
				.where(($) => [
					$.status.eq("disconnected"),
					$.disconnectedAt.lt(new Date(now.getTime() - GONE_AFTER_MS)),
				]),
		)
		return {
			...resumed,
			baseline: yield* baselineProviders(importing, resumed.armed),
			gone: new Set(gone.map((row) => row.provider)),
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
 * Limit signals from when they sat on the primary move, with their history, to the environment
 * their evidence names (what people did with them stays). One that environment already has stays
 * put and resolves.
 */
const moveLimitSignals = Effect.fn("Customers.moveLimitSignals")(function* (snapshot: Snapshot) {
	const db = yield* Database.Database
	const ids = new Set(snapshot.accounts.map((account) => account.stored.id))
	const held = new Set(snapshot.signals.map((signal) => `${signal.ruleId}:${signal.accountId}`))
	const moves = snapshot.signals.flatMap((signal) => {
		const target = limitSignalTarget(signal, ids, held)
		return target === null ? [] : [{ signal, target }]
	})
	if (moves.length === 0) return snapshot.signals
	yield* db.transaction(
		Effect.forEach(
			moves,
			({ signal, target }) =>
				Effect.gen(function* () {
					yield* db.run(
						SQLite.update(schema.customerSignalsTable)
							.set({ accountId: target, updatedAt: snapshot.org.now })
							.where(($) => [$.id.eq(signal.id)]),
					)
					yield* db.run(
						SQLite.update(schema.customerEventsTable)
							.set({ accountId: target })
							.where(($) => [
								$.provider.eq("hazel"),
								SQLite.jsonExtract($.data, "$.signalId", SQLite.nullable(SQLite.text)).eq(
									signal.id,
								),
							]),
					)
				}),
			{ discard: true },
		),
	)
	const moved = new Map(moves.map(({ signal, target }) => [signal.id, target]))
	return snapshot.signals.map((signal) => ({
		...signal,
		accountId: moved.get(signal.id) ?? signal.accountId,
	}))
})

/**
 * Every rule against the chunk's accounts (a primary with environments over its group's facts, its
 * environments only for `ENVIRONMENT_TEMPLATES`), then their counters (their signals are final). Returns the chunk's
 * unclosed signals.
 */
const writeSignals = Effect.fn("Customers.writeSignals")(function* (snapshot: Snapshot, run: SignalRun) {
	const db = yield* Database.Database
	const { now } = snapshot.org
	const { matches, triggered, counts } = run
	const signals = yield* moveLimitSignals(snapshot)
	const unclosed = new Map(signals.map((signal) => [`${signal.ruleId}:${signal.accountId}`, signal]))
	const live: Live = new Map(unclosed)
	const factsOf = evaluatedFor(snapshot.accounts)

	for (const rule of snapshot.rules) {
		const ruleBaseline = inBaseline(rule.template, run.baseline)
		const sourceGone = TEMPLATES[rule.template].requiredSources.some((provider) => run.gone.has(provider))
		yield* db.transaction(
			Effect.forEach(
				snapshot.accounts,
				(account) =>
					Effect.gen(function* () {
						const { stored } = account
						const facts = factsOf(rule.template, account)
						if (facts === null) return
						const key = `${rule.id}:${stored.id}`
						const result = evaluate(rule, facts, snapshot.org)
						const signal = unclosed.get(key) ?? null
						// Its source is unavailable (in error, disconnected): what people did with the signal
						// stays as it is, and nothing new opens until the source is back; disconnected for
						// good, the signal closes.
						if (result._tag === "NoMatch" && result.reason === "Missing data source") {
							if (signal === null || !sourceGone) return
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
	if (run.armed.length > 0) yield* clearBaselineFor(run.armed)

	// Signals of deleted accounts: closed (an account no longer evaluated never resolves them).
	const orphans = yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select("id", "status")
			.where(($) => [
				$.closedAt.isNull(),
				SQLite.notInSubquery(
					$.accountId,
					SQLite.from(schema.customerAccountsTable)
						.select("id")
						.where((a) => [a.deletedAt.isNull()]),
				),
			]),
	)
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
	const inWindow = <P>($: {
		readonly day: SQLite.Expr<string, P>
		readonly accountId: SQLite.Expr<string, P>
		readonly eventCount: SQLite.Expr<number, P>
		readonly sessionCount: SQLite.Expr<number, P>
		readonly signedIn: SQLite.Expr<boolean, P>
	}) => [
		$.day.gte(start),
		$.day.lte(to),
		isActive($),
		SQLite.inSubquery(
			$.accountId,
			SQLite.from(schema.customerAccountsTable)
				.select("id")
				.where((a) => [a.deletedAt.isNull()]),
		),
	]
	// Days to the key's next active day, at most 30 (none: 30).
	const gapOf = (day: SQLite.Expr<string, any>, next: SQLite.Expr<string | null, any>) =>
		SQLite.least(
			SQLite.coalesce(
				SQLite.cast(SQLite.julianday(next).sub(SQLite.julianday(day)), SQLite.integer),
				30,
			),
			30,
		)
	const nextDay = (day: SQLite.Expr<string, any>, key: SQLite.Expr<string, any>) =>
		SQLite.over(SQLite.lead(day), SQLite.windowSpec({ partitionBy: [key], orderBy: [[day, "asc"]] }))
	const contacts: Gaps = yield* db.run(
		SQLite.fromQuery(
			SQLite.from(schema.customerActivityDailyTable)
				.select(($) => ({ day: $.day, next: nextDay($.day, $.contactId) }))
				.where(inWindow),
			"g",
		)
			.select(($) => ({ day: $.day, gap: gapOf($.day, $.next), n: SQLite.count() }))
			.groupBy("day", "gap"),
	)
	const accounts: Gaps = yield* db.run(
		SQLite.fromQuery(
			SQLite.fromQuery(
				SQLite.from(schema.customerActivityDailyTable)
					.select("accountId", "day")
					.where(inWindow)
					.distinct(),
				"d",
			).select(($) => ({ day: $.day, next: nextDay($.day, $.accountId) })),
			"g",
		)
			.select(($) => ({ day: $.day, gap: gapOf($.day, $.next), n: SQLite.count() }))
			.groupBy("day", "gap"),
	)
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
	/** Σ variable MRR: run-rate MRR is `mrrMinor + variableMrrMinor`. */
	variableMrrMinor: number
	/** Accounts with run-rate MRR: a customer billed only on usage pays too. */
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
		totals.variableMrrMinor += rollup.variableMrrMinor
		if (rollup.mrrMinor + rollup.variableMrrMinor > 0) totals.payingAccounts++
		if (rollup.lifecycleStage === "trialing") totals.trialingAccounts++
		if (highRisk.has(stored.id)) totals.atRiskMrrMinor += rollup.mrrMinor
		const status = scores.get(stored.id)?.status
		if (status === "healthy") totals.healthy++
		else if (status === "at_risk") totals.atRisk++
		else if (status === "critical") totals.critical++
	}
}

/** The user counts (DAU/WAU/MAU, active accounts) of the recorded days in `[from, to]`, from activity. */
const redoUserCounts = Effect.fn("Customers.redoUserCounts")(function* (from: Day, to: Day) {
	const db = yield* Database.Database
	const users = yield* activeCounts(from, to)
	const days = dayRange(to, daysBetween(from, to) + 1).map((day) => ({ day, ...users(day) }))
	// One statement, the days as one JSON parameter.
	yield* db.run(
		SQLite.update(schema.customerOrgDailyTable)
			.from(
				SQLite.jsonRows(days, {
					day: SQLite.text,
					activeAccounts: SQLite.integer,
					dau: SQLite.integer,
					wau: SQLite.integer,
					mau: SQLite.integer,
				}),
				"j",
			)
			.set(($) => ({ activeAccounts: $.j.activeAccounts, dau: $.j.dau, wau: $.j.wau, mau: $.j.mau }))
			.where(($) => [$.day.eq($.j.day)]),
	)
})

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
		// Rows recorded before activity was backfilled kept their counts: redone once, from activity.
		if (Option.isNone(yield* readObjectMeta(USER_COUNTS_REDONE_KEY))) {
			yield* redoUserCounts(addDays(today, -HISTORY_DAYS), addDays(yesterday, -1))
			yield* writeObjectMeta(USER_COUNTS_REDONE_KEY, "1")
		}
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

/** Environments whose primary is gone (deleted by a sync) stand alone again. */
const releaseOrphanedEnvironments = Effect.flatMap(Database.Database, (db) =>
	db.run(
		SQLite.update(schema.customerAccountsTable)
			.set({ primaryAccountId: null })
			.where(($) => [
				SQLite.inSubquery(
					$.primaryAccountId,
					SQLite.from(schema.customerAccountsTable)
						.select("id")
						.where((a) => [a.deletedAt.isNotNull()]),
				),
			]),
	),
)

/** A subscription's billed span: from its trial's end (or start) until it was canceled; null without one. */
const paidSpanOf = (sub: schema.CustomerSubscription) => {
	if (sub.status === "trialing" || sub.status === "paused") return null
	const start = sub.trialEndsAt ?? sub.startedAt
	if (start === null) return null
	if (sub.status === "canceled" && sub.canceledAt === null) return null
	// An active subscription may carry the date it is scheduled to cancel on.
	return {
		from: dayOf(start),
		until: sub.status === "canceled" && sub.canceledAt !== null ? dayOf(sub.canceledAt) : null,
	}
}

const within = (day: Day, span: { from: Day; until: Day | null }) =>
	day >= span.from && (span.until === null || day < span.until)

/**
 * An account's contracted MRR per day from its subscriptions' paid periods (trials and cancellations
 * end them), each at what its invoices billed then (`recurringHistoryOf`).
 */
export const mrrHistory = (
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	currency: string,
	days: ReadonlyArray<Day>,
	revenue: RevenueBasis,
	invoices: ReadonlyArray<SubscriptionInvoice> = [],
): Array<number> => {
	const periods = subscriptions.flatMap((sub) => {
		if (sub.currency !== currency) return []
		const span = paidSpanOf(sub)
		return span === null ? [] : [{ ...span, mrr: recurringHistoryOf(sub, invoices, revenue, days) }]
	})
	return days.map((day, index) =>
		periods.reduce((sum, period) => (within(day, period) ? sum + period.mrr[index] : sum), 0),
	)
}

/** Whether the account paid in `currency` on each day: a subscription that pays (`pays`) in its paid span. */
const paidHistory = (
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	currency: string,
	days: ReadonlyArray<Day>,
): Array<boolean> => {
	const spans = subscriptions.flatMap((sub) => {
		const span = sub.currency === currency && pays(sub) ? paidSpanOf(sub) : null
		return span === null ? [] : [span]
	})
	return days.map((day) => spans.some((span) => within(day, span)))
}

/**
 * The trailing usage averages (`trailingUsageOf`) as of the end of each day. They change only when a
 * month starts or an invoice is billed, so they are computed on those days and carried between.
 */
const usageHistory = (
	invoices: ReadonlyArray<BilledInvoice>,
	revenue: RevenueBasis,
	currency: string,
	days: ReadonlyArray<Day>,
): Array<TrailingUsage> => {
	const changes = new Set(
		invoices.flatMap((invoice) => (invoice.issuedAt === null ? [] : [dayOf(invoice.issuedAt)])),
	)
	let current: TrailingUsage | null = null
	return days.map((day, index) => {
		if (current === null || index === 0 || day.endsWith("-01") || changes.has(day)) {
			// The end of the day: what was billed by then.
			current = trailingUsageOf(
				invoices,
				revenue,
				currency,
				new Date(Date.parse(`${addDays(day, 1)}T00:00:00.000Z`) - 1),
			)
		}
		return current
	})
}

/**
 * Restating (a new revenue basis): the last year's movements and the org's daily billing columns go.
 * At-risk MRR stays as recorded: who was at risk on a past day cannot be rebuilt.
 */
const clearBillingHistory = (first: Day, today: Day, accountIds: ReadonlyArray<CustomerAccountId>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		// Live accounts only: a rebuild does not restore a deleted one's, and retention reads them.
		yield* db.run(
			SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [
				$.day.gte(first),
				inList($.accountId, accountIds),
			]),
		)
		yield* db.run(
			SQLite.deleteFrom(schema.customerVariableMrrChangesTable).where(($) => [
				$.day.gte(first),
				inList($.accountId, accountIds),
			]),
		)
		yield* db.run(
			SQLite.update(schema.customerOrgDailyTable)
				.set({
					mrrMinor: 0,
					variableMrrMinor: 0,
					payingAccounts: 0,
					trialingAccounts: 0,
				})
				.where(($) => [$.day.gte(first), $.day.lt(today)]),
		)
	})

/**
 * The last year rebuilt from the sources (after a connection's first backfill, the demo seed, or a new
 * revenue basis): MRR movements of the accounts without any in that year before today (today's
 * replaced; their MRR, variable MRR and basis set to where the series end, in the same transaction,
 * so a crash before the rollups cannot count them twice), and the org's daily rows (MRR, variable
 * MRR, paying, trialing, active, DAU/WAU/MAU, health counts) for the days without one; a day recorded
 * before billing data existed (no MRR, no paying account) gets its billing columns.
 *
 * `restate` (a new revenue basis, `docs/customers/revenue.md`): the year's movements and the org's
 * daily billing columns are cleared first, so every account's history is rebuilt under the new basis.
 */
export const rebuildHistory = Effect.fn("Customers.rebuildHistory")(function* (
	base: SnapshotBase,
	restate = false,
	refreshPaying = false,
) {
	const db = yield* Database.Database
	const { today, currency } = base.org
	const { revenue } = base
	const days = dayRange(today, HISTORY_DAYS + 1)
	const first = days[0]
	const before = addDays(first, -1)
	const live = new Set(base.accountIds)
	const accounts = (yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "mrrMinor", "variableMrrMinor", "mrrBasis", "mrrSource")
			.where(($) => [$.deletedAt.isNull()]),
	)).filter((account) => live.has(account.id))
	const billingBy = billingByAccount(
		base.autumnReady,
		yield* db.run(SQLite.from(schema.customerSubscriptionsTable).select()),
		new Map(accounts.map((account) => [account.id, account.mrrSource])),
	)
	// Today's movement alone is not history: one a compute wrote while billing was still importing
	// (a partial MRR's jump) is replaced by the rebuilt series. Restating, there is none left.
	const withMovements = restate
		? new Set<CustomerAccountId>()
		: new Set(
				(yield* db.run(
					SQLite.from(schema.customerMrrMovementsTable)
						.select("accountId")
						.where(($) => [$.day.gte(first), $.day.lt(today)])
						.distinct(),
				)).map((row) => row.accountId),
			)
	const withChanges = restate
		? new Set<CustomerAccountId>()
		: new Set(
				(yield* db.run(
					SQLite.from(schema.customerVariableMrrChangesTable)
						.select("accountId")
						.where(($) => [$.day.gte(first), $.day.lt(today)])
						.distinct(),
				)).map((row) => row.accountId),
			)
	const variableChanges: Array<Record<string, unknown>> = []
	// Invoices billed in the window of the year's first day and a year before it (long service periods).
	const invoicesFrom = new Date(
		windowMonths(new Date(`${first}T00:00:00.000Z`), revenue.months)[0] - USAGE_LOOKBACK_MS,
	)
	const series = [before, ...days]
	const mrr = Array.from({ length: days.length }, () => 0)
	const variable = Array.from({ length: days.length }, () => 0)
	const paying = Array.from({ length: days.length }, () => 0)
	const trialing = Array.from({ length: days.length }, () => 0)
	const movements: Array<Record<string, unknown>> = []
	const current: Array<{
		id: CustomerAccountId
		mrrMinor: number
		variableMrrMinor: number
		mrrBasis: string | null
	}> = []
	// In chunks: an account's invoices carry their lines.
	for (const chunk of accountChunks(accounts)) {
		const invoices = yield* db.run(
			SQLite.from(schema.customerInvoicesTable)
				.select(
					"accountId",
					"subscriptionId",
					"status",
					"currency",
					"issuedAt",
					"paidAt",
					"amountPaidMinor",
					"servicePeriodStart",
					"lines",
				)
				.where(($) => [
					inList(
						$.accountId,
						chunk.map((account) => account.id),
					),
					$.status.in_("open", "paid"),
					$.currency.eq(currency),
					$.issuedAt.gte(invoicesFrom),
				]),
		)
		const invoicesBy = new Map<CustomerAccountId, Array<SubscriptionInvoice>>()
		for (const invoice of invoices) {
			const list = invoicesBy.get(invoice.accountId)
			if (list === undefined) invoicesBy.set(invoice.accountId, [invoice])
			else list.push(invoice)
		}
		for (const account of chunk) {
			const subs = billingBy.get(account.id)?.subscriptions ?? []
			const own = invoicesBy.get(account.id) ?? []
			const recurring = mrrHistory(subs, currency, series, revenue, own)
			const paid = paidHistory(subs, currency, series)
			const usage = usageHistory(own, revenue, currency, series)
			const invoiceOnly = !subs.some((sub) => sub.currency === currency)
			// As the rollup counts them (`rollupAccount`): usage while billed by a subscription, or
			// (with none) billed last month.
			const accountMrr = series.map(
				(_, index) => recurring[index] + (paid[index] ? usage[index].recurringUsageMinor : 0),
			)
			const accountVariable = series.map((_, index) =>
				paid[index] || (invoiceOnly && usage[index].billedLastMonth) ? usage[index].variableMinor : 0,
			)
			const trial = new Uint8Array(days.length)
			for (const sub of subs) {
				if (sub.trialEndsAt === null || sub.startedAt === null) continue
				const end =
					sub.canceledAt !== null && sub.canceledAt < sub.trialEndsAt
						? sub.canceledAt
						: sub.trialEndsAt
				const from = Math.max(0, daysBetween(first, dayOf(sub.startedAt)))
				const until = Math.min(days.length, daysBetween(first, dayOf(end)))
				for (let index = from; index < until; index++) trial[index] = 1
			}
			for (let index = 0; index < days.length; index++) {
				mrr[index] += accountMrr[index + 1]
				variable[index] += accountVariable[index + 1]
				if (accountMrr[index + 1] + accountVariable[index + 1] > 0) paying[index]++
				trialing[index] += trial[index]
			}
			const last = series.length - 1
			// A series kept as recorded keeps its balance: the next compute records the change to it.
			const mrrNow = withMovements.has(account.id) ? account.mrrMinor : accountMrr[last]
			const variableNow = withChanges.has(account.id) ? account.variableMrrMinor : accountVariable[last]
			const basisNow = withMovements.has(account.id) ? account.mrrBasis : revenue.key
			if (
				mrrNow !== account.mrrMinor ||
				variableNow !== account.variableMrrMinor ||
				basisNow !== account.mrrBasis
			)
				current.push({
					id: account.id,
					mrrMinor: mrrNow,
					variableMrrMinor: variableNow,
					mrrBasis: basisNow,
				})
			if (!withChanges.has(account.id)) {
				for (let index = 1; index < accountVariable.length; index++) {
					if (accountVariable[index - 1] === accountVariable[index]) continue
					variableChanges.push({
						accountId: account.id,
						day: days[index - 1],
						fromMinor: accountVariable[index - 1],
						toMinor: accountVariable[index],
						currency,
					})
				}
			}
			if (withMovements.has(account.id)) continue
			let everPaid = false
			for (let index = 1; index < accountMrr.length; index++) {
				const from = accountMrr[index - 1]
				const to = accountMrr[index]
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
		}
	}
	const users = yield* activeCounts(first, today)
	const health = new Map(
		(yield* db.run(
			SQLite.from(schema.customerHealthDailyTable)
				.select(($) => ({ day: $.day, status: $.status, count: SQLite.count() }))
				.where(($) => [$.day.gte(first)])
				.groupBy("day", "status"),
		)).map((row) => [`${row.day}:${row.status}`, row.count]),
	)
	const healthOf = (day: Day, status: string) => health.get(`${day}:${status}`) ?? 0
	// Today's row is written by the compute that follows, with its at-risk MRR.
	const orgDays = days.flatMap((day, index) =>
		day < today
			? [
					{
						day,
						mrrMinor: mrr[index],
						variableMrrMinor: variable[index],
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
			if (restate)
				yield* clearBillingHistory(
					first,
					today,
					accounts.map((account) => account.id),
				)
			yield* db.run(
				SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [
					$.day.eq(today),
					SQLite.notInSubquery(
						$.accountId,
						SQLite.from(schema.customerMrrMovementsTable)
							.select("accountId")
							.where((m) => [m.day.gte(first), m.day.lt(today)]),
					),
				]),
			)
			for (const chunk of accountChunks(movements, rowsPerInsert(7))) {
				yield* db.run(SQLite.insertInto(schema.customerMrrMovementsTable).values(chunk as never))
			}
			yield* db.run(
				SQLite.deleteFrom(schema.customerVariableMrrChangesTable).where(($) => [
					$.day.eq(today),
					SQLite.notInSubquery(
						$.accountId,
						SQLite.from(schema.customerVariableMrrChangesTable)
							.select("accountId")
							.where((m) => [m.day.gte(first), m.day.lt(today)]),
					),
				]),
			)
			for (const chunk of accountChunks(variableChanges, rowsPerInsert(5))) {
				yield* db.run(
					SQLite.insertInto(schema.customerVariableMrrChangesTable).values(chunk as never),
				)
			}
			for (const account of current) {
				yield* db.run(
					SQLite.update(schema.customerAccountsTable)
						.set({
							mrrMinor: account.mrrMinor,
							variableMrrMinor: account.variableMrrMinor,
							mrrBasis: account.mrrBasis,
							updatedAt: now,
						})
						.where(($) => [$.id.eq(account.id)]),
				)
			}
			// One statement, the days as one JSON parameter. Recorded days get their user counts again
			// (activity may have been backfilled since), and their billing columns while still empty
			// (recorded before any billing data came in, or cleared by a restatement).
			yield* db.run(
				SQLite.insertInto(schema.customerOrgDailyTable)
					.select(
						SQLite.jsonRows(orgDays, {
							day: SQLite.text,
							mrrMinor: SQLite.integer,
							variableMrrMinor: SQLite.integer,
							payingAccounts: SQLite.integer,
							trialingAccounts: SQLite.integer,
							activeAccounts: SQLite.integer,
							dau: SQLite.integer,
							wau: SQLite.integer,
							mau: SQLite.integer,
							healthy: SQLite.integer,
							atRisk: SQLite.integer,
							critical: SQLite.integer,
							atRiskMrrMinor: SQLite.integer,
						}),
					)
					.onConflictDoUpdate({
						target: ["day"],
						set: ($, excluded) => {
							const noBilling = $.mrrMinor.eq(0).and($.payingAccounts.eq(0))
							return {
								activeAccounts: excluded.activeAccounts,
								dau: excluded.dau,
								wau: excluded.wau,
								mau: excluded.mau,
								mrrMinor: SQLite.iif(noBilling, excluded.mrrMinor, $.mrrMinor),
								// Its own test: a Stripe switch clears it while Autumn's MRR stays.
								variableMrrMinor: SQLite.iif(
									$.variableMrrMinor.eq(0),
									excluded.variableMrrMinor,
									$.variableMrrMinor,
								),
								payingAccounts: refreshPaying
									? excluded.payingAccounts
									: SQLite.iif(noBilling, excluded.payingAccounts, $.payingAccounts),
								trialingAccounts: SQLite.iif(
									noBilling,
									excluded.trialingAccounts,
									$.trialingAccounts,
								),
							}
						},
					}),
			)
		}),
	)
	yield* Effect.annotateCurrentSpan({
		"customers.movements": movements.length,
		"customers.variable_changes": variableChanges.length,
		"customers.rebuilt_accounts": current.length,
		"customers.restated": restate,
	})
})

// ---------------------------------------------------------------------------
// 6. Retention
// ---------------------------------------------------------------------------

/** Once a day: daily rows past 400 days, events past 2 years, closed signals and sync runs. */
const prune = Effect.fn("Customers.prune")(function* (now: Date) {
	const db = yield* Database.Database
	const today = dayOf(now)
	if (Option.getOrUndefined(yield* readObjectMeta(PRUNED_KEY)) === today) return
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
	yield* writeObjectMeta(PRUNED_KEY, today)
})

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Billing data read before Hazel stored what revenue needs (`REVENUE_DATA_VERSION`): each Stripe
 * connection imports again from scratch (a backfill: invoices with their lines, the price catalog),
 * once. Its history is restated after that import (`followRevenueBasis`, the same release's new method).
 */
const upgradeRevenueData = (now: Date) =>
	Effect.gen(function* () {
		if (Option.getOrUndefined(yield* readObjectMeta(REVENUE_DATA_KEY)) === REVENUE_DATA_VERSION) return
		const db = yield* Database.Database
		// Together: a retry after a partial write would find the reset connections and record none.
		const walked = yield* db.transaction(
			Effect.gen(function* () {
				const rows = yield* db.run(
					SQLite.update(schema.customerConnectionsTable)
						.set({ backfilledAt: null, lastSuccessAt: null, nextSyncAt: now, updatedAt: now })
						.where(($) => [
							$.provider.eq("stripe"),
							$.status.neq("disconnected"),
							$.backfilledAt.isNotNull(),
						])
						.returning("id"),
				)
				yield* saveRevenueWalk({ ids: rows.map((row) => row.id), at: now.getTime() })
				yield* writeObjectMeta(REVENUE_DATA_KEY, REVENUE_DATA_VERSION)
				return rows
			}),
		)
		yield* Effect.logInfo("Customers billing walked again for revenue data", {
			connections: walked.length,
		})
	})

/** Of the connections walked again, one that has yet to finish its import (in error too). */
const walkUnfinished = (ids: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const row = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select("id")
				.where(($) => [$.status.neq("disconnected"), $.backfilledAt.isNull(), inList($.id, ids)])
				.limit(1),
		)
		return Option.isSome(row)
	})

/**
 * A rebuild waits for the connections walked again, up to the age a backfill counts as importing. Past
 * it (one stuck, or in error) it runs on what is there, and `settleRevenueWalk` keeps the debt.
 */
const awaitingRevenueWalk = (now: Date) =>
	Effect.gen(function* () {
		const walk = Option.getOrUndefined(yield* revenueWalk)
		if (walk === undefined || now.getTime() - walk.at >= BACKFILL_MAX_AGE_MS) return false
		return yield* walkUnfinished(walk.ids)
	})

/** After a rebuild: a restatement that ran before the walk finished is owed again once it has. */
const settleRevenueWalk = (restated: boolean) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		// Together: the request must not go without the debt that replaces it.
		yield* db.transaction(
			Effect.gen(function* () {
				yield* deleteObjectMeta(RESTATE_KEY)
				const walk = Option.getOrUndefined(yield* revenueWalk)
				if (walk !== undefined && (yield* walkUnfinished(walk.ids))) {
					if (restated) yield* saveRevenueWalk({ ...walk, owed: true })
					return
				}
				yield* clearRevenueWalk
				yield* clearPayingRefresh
			}),
		)
	})

/**
 * The revenue basis changed (rules or window edited, or a new method, `REVENUE_METHOD_VERSION`): the
 * billing history is restated under it by the next rebuild, once no billing import runs. Computes in
 * between write no movement for the change (`mrrBasis`).
 */
const followRevenueBasis = Effect.fnUntraced(function* (now: Date) {
	const db = yield* Database.Database
	const settings = yield* db.first(SQLite.from(schema.customerSettingsTable).select("id").limit(1))
	if (Option.isNone(settings)) return
	const walk = Option.getOrUndefined(yield* revenueWalk)
	if (walk !== undefined && !(yield* walkUnfinished(walk.ids))) {
		if (walk.owed === true) yield* writeObjectMeta(RESTATE_KEY, "1")
		yield* clearRevenueWalk
	}
	const { key } = yield* loadRevenueBasis
	const recorded = Option.getOrUndefined(yield* readObjectMeta(REVENUE_BASIS_KEY))
	if (recorded !== key) {
		// None recorded yet: an org without billing history has nothing to restate.
		const history =
			recorded !== undefined ||
			Option.isSome(
				yield* db.first(SQLite.from(schema.customerMrrMovementsTable).select("id").limit(1)),
			) ||
			Option.isSome(
				yield* db.first(
					SQLite.from(schema.customerOrgDailyTable)
						.select("day")
						.where(($) => [SQLite.or($.mrrMinor.gt(0), $.payingAccounts.gt(0))])
						.limit(1),
				),
			)
		if (history) yield* writeObjectMeta(RESTATE_KEY, "1")
		yield* writeObjectMeta(REVENUE_BASIS_KEY, key)
	}
	if (Option.isNone(yield* readObjectMeta(RESTATE_KEY))) return
	if (!(yield* awaitingRevenueWalk(now))) yield* requestHistoryRebuild
})

/**
 * A new org is current from the start: its billing data is read the current way (no walk again,
 * `upgradeRevenueData`), and its history will be computed under its basis (nothing to restate).
 */
export const markRevenueCurrent = Effect.gen(function* () {
	yield* writeObjectMeta(REVENUE_DATA_KEY, REVENUE_DATA_VERSION)
	yield* writeObjectMeta(REVENUE_BASIS_KEY, (yield* loadRevenueBasis).key)
})

/**
 * One alarm turn's compute work: the history rebuild when one is pending and no billing backfill
 * is importing (alone in its turn, the compute right after), else the compute (or its next part).
 */
export const runComputeStep = Effect.fn("Customers.computeStep")(function* (now: Date) {
	yield* upgradeRevenueData(now)
	yield* followRevenueBasis(now)
	const importing = yield* importingProviders(now)
	if (
		!billingImporting(importing) &&
		!(yield* awaitingRevenueWalk(now)) &&
		(yield* historyRebuildPending)
	) {
		const attempts = yield* takeRebuildAttempt
		if (attempts < MAX_REBUILD_ATTEMPTS) {
			const restate = Option.isSome(yield* readObjectMeta(RESTATE_KEY))
			yield* rebuildHistory(yield* loadBase(now), restate, yield* payingRefreshPending)
			yield* settleRevenueWalk(restate)
			yield* clearHistoryRebuild
			// It reset MRR to the plans': a compute spread over turns starts over to add usage to all.
			yield* clearComputeProgress
			yield* resetComputeFailures
			return yield* scheduleComputeAt(now.getTime())
		}
		// It keeps failing: charts go without the rebuilt history rather than computes stopping for good.
		yield* Effect.logError("Customers history rebuild given up", { attempts })
		yield* settleRevenueWalk(Option.isSome(yield* readObjectMeta(RESTATE_KEY)))
		yield* clearHistoryRebuild
	}
	yield* runCompute(now)
})

/** Where a compute spread over several alarm turns stopped, and what it has gathered so far. */
const ComputeProgress = Schema.Struct({
	/** When its first turn ran, its day and Autumn's readiness: another one starts over. */
	startedAt: Schema.Finite,
	day: Day,
	autumnReady: Schema.Boolean,
	/** The revenue basis its totals were summed under: another one starts over. */
	basis: Schema.String,
	/** The primary of the last group of accounts done (groups go in their primary's id order). */
	after: CustomerAccountId,
	armed: Schema.Array(Schema.String),
	totals: Schema.Struct({
		mrrMinor: Schema.Finite,
		variableMrrMinor: Schema.Finite,
		payingAccounts: Schema.Finite,
		trialingAccounts: Schema.Finite,
		healthy: Schema.Finite,
		atRisk: Schema.Finite,
		critical: Schema.Finite,
		atRiskMrrMinor: Schema.Finite,
	}),
	matches: Schema.Record(Schema.String, Schema.Finite),
	triggered: Schema.Array(Schema.String),
})
const ComputeProgressJson = Schema.fromJsonString(ComputeProgress)
const decodeComputeProgress = Schema.decodeUnknownOption(ComputeProgressJson)
const encodeComputeProgress = Schema.encodeSync(ComputeProgressJson)

/**
 * A compute, or its next part: chunks of accounts until `budgetMs` has passed, then the rest in the
 * next alarm turn (right away), or, after the last chunk, the org-level steps and the next hourly run.
 */
export const runCompute = Effect.fn("Customers.compute")(function* (
	now: Date,
	budgetMs = COMPUTE_TURN_BUDGET_MS,
) {
	const db = yield* Database.Database
	const started = yield* Clock.currentTimeMillis
	const base = yield* loadBase(now)
	const importing = yield* importingProviders(now)
	const rebuildPending = yield* historyRebuildPending
	// The previous turn's, unless unreadable, stale, or from another day or Autumn readiness.
	const progress = Option.getOrUndefined(
		Option.filter(
			Option.flatMap(yield* computeProgress, decodeComputeProgress),
			(saved) =>
				saved.day === base.org.today &&
				saved.autumnReady === base.autumnReady &&
				saved.basis === base.revenue.key &&
				now.getTime() - saved.startedAt < COMPUTE_PROGRESS_MAX_AGE_MS,
		),
	)
	const signals = yield* startSignals(now, importing, {
		armed: progress?.armed ?? (yield* baselineConnections),
		matches: new Map(Object.entries(progress?.matches ?? {})),
		triggered: new Set(progress?.triggered),
	})
	const totals: OrgTotals =
		progress === undefined
			? {
					mrrMinor: 0,
					variableMrrMinor: 0,
					payingAccounts: 0,
					trialingAccounts: 0,
					healthy: 0,
					atRisk: 0,
					critical: 0,
					atRiskMrrMinor: 0,
				}
			: { ...progress.totals }
	const chunks = groupChunks(
		progress === undefined ? base.groups : base.groups.filter(([primary]) => primary > progress.after),
	)
	let done = 0
	let switched = 0
	for (const groups of chunks) {
		const snapshot = yield* loadAccounts(base, groups.flat())
		switched += yield* writeRollups(snapshot, importing, rebuildPending)
		const scores = scoreAll(snapshot)
		yield* writeHealth(snapshot, scores)
		const live = yield* writeSignals(withTodayHealth(snapshot, scores), signals)
		addTotals(totals, snapshot, scores, live)
		done++
		if (
			done < chunks.length &&
			(done >= MAX_CHUNKS_PER_TURN || (yield* Clock.currentTimeMillis) - started >= budgetMs)
		)
			break
	}
	const elapsedMs = (yield* Clock.currentTimeMillis) - started
	yield* Effect.annotateCurrentSpan({
		"customers.accounts": base.accountIds.length,
		"customers.rules": base.rules.length,
		"customers.autumn_ready": base.autumnReady,
		"customers.mrr_source_switches": switched,
		"customers.billing_importing": billingImporting(importing),
		"customers.history_rebuild_pending": rebuildPending,
		"customers.resumed": progress !== undefined,
		"customers.chunks": done,
		"customers.chunks_left": chunks.length - done,
		"customers.turn_ms": elapsedMs,
	})
	if (done < chunks.length) {
		const last = chunks[done - 1]
		yield* saveComputeProgress(
			encodeComputeProgress({
				startedAt: progress?.startedAt ?? now.getTime(),
				day: base.org.today,
				autumnReady: base.autumnReady,
				basis: base.revenue.key,
				after: last[last.length - 1][0],
				armed: signals.armed,
				totals,
				matches: Object.fromEntries(signals.matches),
				triggered: [...signals.triggered],
			}),
		)
		yield* Effect.logInfo("Customers compute continues next turn", {
			chunks: done,
			chunksLeft: chunks.length - done,
			accounts: base.accountIds.length,
			elapsedMs,
		})
		yield* resetComputeFailures
		return yield* scheduleComputeAt(yield* Clock.currentTimeMillis)
	}
	yield* finishSignals(now, base.rules, signals)
	yield* writeOrgDay(base, totals)
	yield* releaseOrphanedEnvironments
	yield* prune(now)
	yield* db.run(
		SQLite.update(schema.customerSettingsTable)
			.set({ lastComputedAt: now, updatedAt: now })
			.where(($) => [$.id.eq(base.settings.id)]),
	)
	yield* clearComputeProgress
	// Names a source changed, accounts a source deleted: chat's view of linked channels follows.
	yield* publishChannelCustomersAfterCompute
	// Suggested channel links follow the accounts, contacts and links (logged, never fails it).
	// Before the failure count is reset: a refresh that stalls the turn keeps the backoff.
	yield* refreshSuggestionsAfterCompute
	yield* resetComputeFailures
	// Hourly; sooner after a person's change during a compute spread over turns.
	const again = yield* takeComputeAgain
	yield* scheduleComputeAt(now.getTime() + (again ? COMPUTE_DEBOUNCE_MS : COMPUTE_INTERVAL_MS))
})

/** Needs attention mutes whose time ended: the accounts' signals show in the queue again. */
export const unmuteExpired = Effect.fn("Customers.unmuteExpired")(function* (now: Date) {
	const db = yield* Database.Database
	const due = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id")
			.where(($) => [$.attentionMutedUntil.lte(now)]),
	)
	for (const account of due) {
		yield* db.run(
			SQLite.update(schema.customerAccountsTable)
				.set({
					attentionMutedAt: null,
					attentionMutedUntil: null,
					attentionMutedByUserId: null,
					updatedAt: now,
				})
				.where(($) => [$.id.eq(account.id)]),
		)
		yield* hazelEvent(account.id, "account.attention_unmuted", "Needs attention mute ended", now, {})
	}
	return due.length
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
