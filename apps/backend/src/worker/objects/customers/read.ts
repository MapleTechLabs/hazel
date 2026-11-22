/**
 * The read RPCs' queries (`docs/customers/tech-design.md` §2 "RPC-only"): the overview's KPIs and
 * series (from `customer_org_daily` and the movements), one account's detail and series, sparklines,
 * and the paged lists. Built-in per-account series derive from their sources (`./facts.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type {
	AccountBrief,
	ActiveUsersPoint,
	ContactRow,
	CustomersRange,
	Day,
	HealthDistributionRow,
	Kpi,
	MetricSeries,
	Mover,
	MrrMovementBucket,
	MrrMovementType,
	NewTrial,
	OverviewResult,
	RevenueBucket,
	SeriesPoint,
} from "@hazel/domain/customers"
import { HealthStatus, logoOf } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { type AccountFacts, type HealthPoint, type MetricPoint, mrrSeries, seriesOf } from "./facts"
import {
	addRevenue,
	type BilledInvoice,
	emptySplit,
	loadRevenueBasis,
	type RevenueBasis,
	recurringMrrOf,
	type RevenueSplit,
	totalOf,
} from "./revenue"
import { inList, isActive } from "./sql"
import { addDays, dayOf, dayRange } from "./time"

/** A mover needs a baseline: this many average daily active users in the previous window. Below
 * it a percentage is noise (1 user-day to 9 reads +800%). */
export const MOVER_MIN_BASELINE = 1

type RankedMover = Pick<Mover, "accountId" | "previousAvg" | "currentAvg" | "changePct">

/** The five biggest gains and drops in average daily active users, from each account's active
 * user-days per window of `days`; accounts under the baseline are left out. */
export const rankMovers = (
	rows: ReadonlyArray<{ accountId: CustomerAccountId; current: number; previous: number }>,
	days: number,
): { gainers: Array<RankedMover>; decliners: Array<RankedMover> } => {
	const round1 = (value: number) => Math.round(value * 10) / 10
	const changes = rows.flatMap((row) => {
		// The percentage comes from the averages the row shows, so a pair that rounds flat drops out.
		const previous = round1(Number(row.previous) / days)
		const current = round1(Number(row.current) / days)
		return previous < MOVER_MIN_BASELINE || current === previous
			? []
			: [
					{
						accountId: row.accountId,
						previousAvg: previous,
						currentAvg: current,
						changePct: round1(((current - previous) / previous) * 100),
					},
				]
	})
	return {
		gainers: changes
			.filter((row) => row.changePct > 0)
			.sort((a, b) => b.changePct - a.changePct)
			.slice(0, 5),
		decliners: changes
			.filter((row) => row.changePct < 0)
			.sort((a, b) => a.changePct - b.changePct)
			.slice(0, 5),
	}
}

export const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 } satisfies Record<
	CustomersRange,
	number
>

const BUCKET = {
	"7d": "day",
	"30d": "day",
	"90d": "week",
	"12m": "month",
} satisfies Record<CustomersRange, OverviewResult["bucket"]>

/** `limit` clamped to 1–100 (default 50); the cursor is an offset. */
export const pageOf = (request: { readonly cursor?: string; readonly limit?: number }) => ({
	limit: Math.min(100, Math.max(1, request.limit ?? 50)),
	offset: Math.max(0, Number.parseInt(request.cursor ?? "0", 10) || 0),
})

/** Fetch `limit + 1` rows; the extra one says there is a next page. */
export const pageResult = <A>(
	rows: ReadonlyArray<A>,
	page: { readonly limit: number; readonly offset: number },
) => ({
	items: rows.slice(0, page.limit),
	nextCursor: rows.length > page.limit ? String(page.offset + page.limit) : null,
})

const kpi = (value: number, previous: number | null): Kpi => ({
	value,
	previous,
	deltaPct:
		previous === null || previous === 0 ? null : Math.round(((value - previous) / previous) * 1000) / 10,
})

/** The bucket a day falls in: itself, its ISO week's Monday, or its month's first day. */
export const bucketOf = (day: Day, bucket: OverviewResult["bucket"]): Day => {
	if (bucket === "day") return day
	if (bucket === "month") return `${day.slice(0, 8)}01`
	const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7
	return addDays(day, -weekday)
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** Retention of `end` over `start` for the accounts that had a value at the start, percent; null without. */
const retention = (pairs: ReadonlyArray<{ start: number; end: number }>) => {
	const cohort = pairs.filter((pair) => pair.start > 0)
	const start = cohort.reduce((sum, pair) => sum + pair.start, 0)
	if (start <= 0) return null
	const end = cohort.reduce((sum, pair) => sum + pair.end, 0)
	return Math.round((end / start) * 1000) / 10
}

/**
 * Run-rate NRR over the range and the one before: per account, run-rate MRR (MRR + variable MRR)
 * at a day is its current one less the MRR movements and variable MRR changes after it; the
 * customers with run-rate at a range's start, their run-rate at its end over theirs at its start.
 */
const runRateRetention = (
	accounts: ReadonlyArray<
		Pick<schema.CustomerAccount, "id" | "mrrMinor" | "variableMrrMinor" | "deletedAt">
	>,
	movements: ReadonlyArray<schema.CustomerMrrMovement>,
	previousStart: Day,
	start: Day,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const changes = yield* db.run(
			SQLite.from(schema.customerVariableMrrChangesTable)
				.select()
				.where(($) => [$.day.gte(previousStart)]),
		)
		const deltas = new Map<CustomerAccountId, { current: number; previous: number }>()
		const add = (accountId: CustomerAccountId, day: Day, delta: number) => {
			const entry = deltas.get(accountId) ?? { current: 0, previous: 0 }
			if (day >= start) entry.current += delta
			else entry.previous += delta
			deltas.set(accountId, entry)
		}
		for (const movement of movements) add(movement.accountId, movement.day, movement.deltaMinor)
		const mrrSinceStart = new Map<CustomerAccountId, number>()
		for (const movement of movements) {
			if (movement.day < start) continue
			mrrSinceStart.set(
				movement.accountId,
				(mrrSinceStart.get(movement.accountId) ?? 0) + movement.deltaMinor,
			)
		}
		for (const change of changes) add(change.accountId, change.day, change.toMinor - change.fromMinor)
		// A deleted account is gone from its deletion on (compute stops there: what it stored is where
		// its deltas lead back from).
		const goneBy = (account: { deletedAt: Date | null }, day: Day) =>
			account.deletedAt !== null && account.deletedAt < new Date(`${day}T00:00:00.000Z`)
		const runRates = accounts.map((account) => {
			const delta = deltas.get(account.id) ?? { current: 0, previous: 0 }
			const stored = account.mrrMinor + account.variableMrrMinor
			const atStart = stored - delta.current
			return {
				end: account.deletedAt === null ? stored : 0,
				atStart: goneBy(account, start) ? 0 : atStart,
				atPreviousStart: goneBy(account, previousStart) ? 0 : atStart - delta.previous,
			}
		})
		return {
			now: retention(runRates.map((rate) => ({ start: rate.atStart, end: rate.end }))),
			before: retention(runRates.map((rate) => ({ start: rate.atPreviousStart, end: rate.atStart }))),
			contractedAtStart: accounts.filter(
				(account) =>
					!goneBy(account, start) && account.mrrMinor - (mrrSinceStart.get(account.id) ?? 0) > 0,
			).length,
		}
	})

export const overview = Effect.fn("Customers.overview")(function* (range: CustomersRange, now: Date) {
	const db = yield* Database.Database
	const today = dayOf(now)
	const days = RANGE_DAYS[range]
	const bucket = BUCKET[range]
	const start = addDays(today, -(days - 1))
	const previousEnd = addDays(start, -1)
	const previousStart = addDays(previousEnd, -(days - 1))
	const settings = yield* db.first(
		SQLite.from(schema.customerSettingsTable).select("reportingCurrency").limit(1),
	)
	const currency = Option.match(settings, { onNone: () => "usd", onSome: (row) => row.reportingCurrency })

	const daily = yield* db.run(
		SQLite.from(schema.customerOrgDailyTable)
			.select()
			.where(($) => [$.day.gte(addDays(previousStart, -1)), $.day.lte(today)])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const byDay = new Map(daily.map((row) => [row.day, row]))
	/** The latest row on or before `day` within the loaded span. */
	const at = (day: Day) => {
		let found: schema.CustomerOrgDay | undefined
		for (const row of daily) if (row.day <= day) found = row
		return found ?? null
	}
	const current = at(today)
	const previous = at(previousEnd)
	const value = (row: schema.CustomerOrgDay | null, field: keyof schema.CustomerOrgDay) =>
		row === null ? 0 : (row[field] as number)
	const prior = (field: keyof schema.CustomerOrgDay) =>
		previous === null ? null : (previous[field] as number)

	const movements = yield* db.run(
		SQLite.from(schema.customerMrrMovementsTable)
			.select()
			.where(($) => [$.day.gte(previousStart), $.day.lte(today)]),
	)
	const inCurrent = movements.filter((movement) => movement.day >= start)
	const inPrevious = movements.filter((movement) => movement.day < start)
	const churnCount = (list: ReadonlyArray<schema.CustomerMrrMovement>) =>
		list.filter((movement) => movement.type === "churn").length
	/** (start MRR + expansion − contraction − churn) ÷ start MRR, over the existing customers. */
	const nrr = (list: ReadonlyArray<schema.CustomerMrrMovement>, startMrr: number) => {
		if (startMrr <= 0) return null
		const kept = list
			.filter(
				(movement) =>
					movement.type === "expansion" ||
					movement.type === "contraction" ||
					movement.type === "churn",
			)
			.reduce((sum, movement) => sum + movement.deltaMinor, 0)
		return Math.round(((startMrr + kept) / startMrr) * 1000) / 10
	}
	const startMrr = value(at(previousEnd), "mrrMinor")
	const previousStartMrr = value(at(addDays(previousStart, -1)), "mrrMinor")
	const nrrNow = nrr(inCurrent, startMrr)
	const nrrBefore = nrr(inPrevious, previousStartMrr)
	const wau = value(current, "wau")
	const mau = value(current, "mau")
	// Revenue collected: paid invoices in the reporting currency, their lines by class, without tax.
	const rangeStart = new Date(`${start}T00:00:00.000Z`)
	const basis = yield* loadRevenueBasis
	const paid = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select(
				"status",
				"currency",
				"issuedAt",
				"paidAt",
				"amountPaidMinor",
				"servicePeriodStart",
				"lines",
			)
			.where(($) => [
				$.status.eq("paid"),
				$.currency.eq(currency),
				$.paidAt.gte(new Date(`${previousStart}T00:00:00.000Z`)),
				$.paidAt.lte(now),
			]),
	)
	const revenue = emptySplit()
	const previousRevenue = emptySplit()
	const revenueBy = new Map<Day, RevenueSplit>(
		dayRange(today, days).map((day) => [bucketOf(day, bucket), emptySplit()]),
	)
	for (const invoice of paid) {
		if (invoice.paidAt === null) continue
		if (invoice.paidAt < rangeStart) {
			addRevenue(previousRevenue, invoice, basis)
			continue
		}
		addRevenue(revenue, invoice, basis)
		const split = revenueBy.get(bucketOf(dayOf(invoice.paidAt), bucket))
		if (split !== undefined) addRevenue(split, invoice, basis)
	}
	const revenueBuckets: Array<RevenueBucket> = [...revenueBy].map(([key, split]) => ({
		start: key,
		...split,
	}))

	// MRR movements per bucket.
	const buckets = new Map<Day, MrrMovementBucket>()
	const accountsIn = new Map<Day, Record<MrrMovementType, Set<string>>>()
	for (const day of dayRange(today, days)) {
		const key = bucketOf(day, bucket)
		if (!buckets.has(key)) {
			buckets.set(key, {
				start: key,
				new: 0,
				expansion: 0,
				reactivation: 0,
				contraction: 0,
				churn: 0,
				net: 0,
				accounts: { new: 0, expansion: 0, reactivation: 0, contraction: 0, churn: 0 },
			})
			accountsIn.set(key, {
				new: new Set(),
				expansion: new Set(),
				reactivation: new Set(),
				contraction: new Set(),
				churn: new Set(),
			})
		}
	}
	for (const movement of inCurrent) {
		const key = bucketOf(movement.day, bucket)
		const entry = buckets.get(key)
		const sets = accountsIn.get(key)
		if (entry === undefined || sets === undefined) continue
		buckets.set(key, {
			...entry,
			[movement.type]: entry[movement.type] + movement.deltaMinor,
			net: entry.net + movement.deltaMinor,
		})
		sets[movement.type].add(movement.accountId)
	}
	const mrrMovements = [...buckets.values()].map((entry) => {
		const sets = accountsIn.get(entry.start)
		return sets === undefined
			? entry
			: {
					...entry,
					accounts: {
						new: sets.new.size,
						expansion: sets.expansion.size,
						reactivation: sets.reactivation.size,
						contraction: sets.contraction.size,
						churn: sets.churn.size,
					},
				}
	})

	// Active users per bucket: the average DAU, and WAU/MAU at the bucket's last day.
	const activeUsers: Array<ActiveUsersPoint> = []
	const grouped = new Map<Day, Array<Day>>()
	for (const day of dayRange(today, days)) {
		const key = bucketOf(day, bucket)
		const list = grouped.get(key)
		if (list === undefined) grouped.set(key, [day])
		else list.push(day)
	}
	for (const [key, list] of grouped) {
		const rows = list.map((day) => byDay.get(day)).filter((row) => row !== undefined)
		const last = rows[rows.length - 1]
		activeUsers.push({
			day: key,
			dau:
				rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.dau, 0) / rows.length),
			wau: last?.wau ?? 0,
			mau: last?.mau ?? 0,
		})
	}

	// Health now, from the accounts.
	const everyAccount = yield* db.run(
		SQLite.from(schema.customerAccountsTable).select(
			"id",
			"name",
			"logoUrl",
			"companyProfile",
			"planName",
			"mrrMinor",
			"variableMrrMinor",
			"healthStatus",
			"deletedAt",
		),
	)
	const accounts = everyAccount.filter((account) => account.deletedAt === null)
	const runRateNrr = yield* runRateRetention(everyAccount, movements, previousStart, start)
	const healthDistribution: Array<HealthDistributionRow> = HealthStatus.literals.map((status) => {
		const rows = accounts.filter((account) => account.healthStatus === status)
		return { status, count: rows.length, mrrMinor: rows.reduce((sum, row) => sum + row.mrrMinor, 0) }
	})
	const accountById = new Map(accounts.map((account) => [account.id, account]))

	// Movers: average daily active users in the range vs the one before. SQL sums each account's
	// active user-days per window; only the movers shown load their daily series.
	const moverDays = Math.min(days, 90)
	const moverStart = addDays(today, -(moverDays - 1))
	const moverPrevious = addDays(moverStart, -moverDays)
	const sums = yield* db.run(
		SQLite.from(schema.customerActivityDailyTable)
			.select(($) => ({
				accountId: $.accountId,
				current: SQLite.countIf($.day.gte(moverStart)),
				previous: SQLite.countIf($.day.lt(moverStart)),
			}))
			.where(($) => [$.day.gte(moverPrevious), isActive($)])
			.groupBy("accountId")
			.having(($) => [SQLite.countIf($.day.lt(moverStart)).gte(moverDays * MOVER_MIN_BASELINE)]),
	)
	const ranked = rankMovers(
		sums.filter((row) => accountById.has(row.accountId)),
		moverDays,
	)
	const shown = [...ranked.gainers, ...ranked.decliners]
	const shownDaily =
		shown.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.customerActivityDailyTable)
						.select(($) => ({ accountId: $.accountId, day: $.day, users: SQLite.count() }))
						.where(($) => [
							inList(
								$.accountId,
								shown.map((row) => row.accountId),
							),
							$.day.gte(moverStart),
							isActive($),
						])
						.groupBy("accountId", "day"),
				)
	const usersOn = new Map(shownDaily.map((row) => [`${row.accountId}:${row.day}`, Number(row.users)]))
	const moverOf = (row: RankedMover): Mover => {
		const account = accountById.get(row.accountId)
		return {
			...row,
			name: account?.name ?? "",
			logoUrl: account === undefined ? null : logoOf(account),
			series: dayRange(today, moverDays).map((day) => ({
				day,
				value: usersOn.get(`${row.accountId}:${day}`) ?? 0,
			})),
		}
	}
	const gainers = ranked.gainers.map(moverOf)
	const decliners = ranked.decliners.map(moverOf)

	const brief = (movement: schema.CustomerMrrMovement, mrrMinor: number): AccountBrief | null => {
		const account = accountById.get(movement.accountId)
		return account === undefined
			? null
			: {
					accountId: account.id,
					name: account.name,
					logoUrl: logoOf(account),
					planName: account.planName,
					mrrMinor,
					at: new Date(`${movement.day}T00:00:00.000Z`),
				}
	}
	const latest = (type: string) =>
		inCurrent.filter((movement) => movement.type === type).sort((a, b) => (a.day < b.day ? 1 : -1))
	const recentChurn = latest("churn")
		.map((movement) => brief(movement, movement.fromMrrMinor))
		.filter((row) => row !== null)
		.slice(0, 5)
	const recentNew = [...latest("new"), ...latest("reactivation")]
		.sort((a, b) => (a.day < b.day ? 1 : -1))
		.map((movement) => brief(movement, movement.toMrrMinor))
		.filter((row) => row !== null)
		.slice(0, 5)
	// Trials started in the range, newest first, one per account.
	const trials = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select("accountId", "status", "listMrrMinor", "startedAt")
			.where(($) => [$.trialEndsAt.isNotNull(), $.startedAt.gte(rangeStart), $.startedAt.lte(now)])
			.orderBy(($) => [[$.startedAt, "desc"]]),
	)
	const trialed = new Set<CustomerAccountId>()
	const newTrials: Array<NewTrial> = []
	for (const trial of trials) {
		const account = accountById.get(trial.accountId)
		if (account === undefined || trial.startedAt === null || trialed.has(account.id)) continue
		trialed.add(account.id)
		newTrials.push({
			accountId: account.id,
			name: account.name,
			logoUrl: logoOf(account),
			planName: account.planName,
			mrrMinor: trial.listMrrMinor ?? 0,
			at: trial.startedAt,
			status: trial.status,
		})
	}

	const anyActivity = yield* db.first(SQLite.from(schema.customerActivityDailyTable).select("day").limit(1))
	const anyBilling = yield* db.first(SQLite.from(schema.customerSubscriptionsTable).select("id").limit(1))
	// One-off invoices without any subscription are billing data too (the Revenue tile).
	const anyInvoice = yield* db.first(SQLite.from(schema.customerInvoicesTable).select("id").limit(1))

	return {
		range,
		currency,
		bucket,
		kpis: {
			mrrMinor: kpi(value(current, "mrrMinor"), prior("mrrMinor")),
			variableMrrMinor: kpi(value(current, "variableMrrMinor"), prior("variableMrrMinor")),
			runRateMrrMinor: kpi(
				value(current, "mrrMinor") + value(current, "variableMrrMinor"),
				previous === null ? null : previous.mrrMinor + previous.variableMrrMinor,
			),
			payingCustomers: kpi(value(current, "payingAccounts"), prior("payingAccounts")),
			activeCustomers: kpi(value(current, "activeAccounts"), prior("activeAccounts")),
			wau: kpi(wau, prior("wau")),
			mau: kpi(mau, prior("mau")),
			revenueMinor: kpi(totalOf(revenue), totalOf(previousRevenue)),
			logoChurn: kpi(churnCount(inCurrent), churnCount(inPrevious)),
			contractedCustomersAtStart: runRateNrr.contractedAtStart,
			atRiskMrrMinor: kpi(value(current, "atRiskMrrMinor"), prior("atRiskMrrMinor")),
			nrrPct: nrrNow === null ? null : kpi(nrrNow, nrrBefore),
			runRateNrrPct: runRateNrr.now === null ? null : kpi(runRateNrr.now, runRateNrr.before),
		},
		revenue,
		revenueBuckets,
		mrrMovements,
		activeUsers,
		healthDistribution,
		topMovers: { gainers, decliners },
		recentChurn,
		recentNew,
		newTrials: newTrials.slice(0, 5),
		hasData: {
			activity: Option.isSome(anyActivity),
			billing: Option.isSome(anyBilling) || Option.isSome(anyInvoice),
		},
	} satisfies OverviewResult
})

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

export const liveAccount = (accountId: CustomerAccountId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.customerAccountsTable)
				.select()
				.where(($) => [$.id.eq(accountId), $.deletedAt.isNull()])
				.limit(1),
		),
	)

/** The facts series derive from, for one account over `days` days (+30 for rolling windows). */
const accountFacts = (account: schema.CustomerAccount, days: number, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const from = addDays(dayOf(now), -(days + 30))
		const activity = yield* db.run(
			SQLite.from(schema.customerActivityDailyTable)
				.select("contactId", "day", "eventCount")
				.where(($) => [$.accountId.eq(account.id), $.day.gte(from), isActive($)]),
		)
		const byDay = new Map<Day, Map<CustomerContactId, number>>()
		for (const row of activity) {
			const map = byDay.get(row.day) ?? new Map()
			map.set(row.contactId, Number(row.eventCount))
			byDay.set(row.day, map)
		}
		const metrics = yield* db.run(
			SQLite.from(schema.customerMetricDailyTable)
				.select()
				.where(($) => [$.accountId.eq(account.id), $.day.gte(from)])
				.orderBy(($) => [[$.day, "asc"]]),
		)
		const metricMap = new Map<string, Array<MetricPoint>>()
		for (const row of metrics) {
			const points = metricMap.get(row.metricKey)
			if (points === undefined) metricMap.set(row.metricKey, [row])
			else points.push(row)
		}
		const movements = yield* db.run(
			SQLite.from(schema.customerMrrMovementsTable)
				.select()
				.where(($) => [$.accountId.eq(account.id)])
				.orderBy(($) => [[$.day, "asc"]]),
		)
		const health = yield* db.run(
			SQLite.from(schema.customerHealthDailyTable)
				.select("day", "score", "status")
				.where(($) => [$.accountId.eq(account.id), $.day.gte(from)])
				.orderBy(($) => [[$.day, "asc"]]),
		)
		return {
			account,
			stage: account.lifecycleStage,
			providers: new Set(),
			contacts: [],
			activity: byDay,
			lastActiveDay: null,
			everActiveContacts: 0,
			priorActive: new Map(),
			subscriptions: [],
			openInvoices: [],
			metrics: metricMap,
			movements,
			health: health as ReadonlyArray<HealthPoint>,
			openIssueSlas: [],
		} satisfies AccountFacts
	})

/** An account's variable MRR on each day, carried back from now through its changes (`customer_variable_mrr_changes`). */
const variableMrrSeries = (account: schema.CustomerAccount, last: Day, count: number) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const changes = yield* db.run(
			SQLite.from(schema.customerVariableMrrChangesTable)
				.select()
				.where(($) => [$.accountId.eq(account.id), $.day.gt(addDays(last, -count))])
				.orderBy(($) => [[$.day, "desc"]]),
		)
		// Newest first: walking back from today, a change on a day was in effect from that day.
		let value = account.variableMrrMinor
		let next = 0
		return dayRange(last, count)
			.reverse()
			.map((day): SeriesPoint => {
				const point = { day, value }
				while (next < changes.length && changes[next].day === day) {
					value = changes[next].fromMinor
					next++
				}
				return point
			})
			.reverse()
	})

export const accountSeries = Effect.fn("Customers.accountSeries")(function* (
	account: schema.CustomerAccount,
	metricKeys: ReadonlyArray<string>,
	range: CustomersRange,
	now: Date,
) {
	const db = yield* Database.Database
	const days = RANGE_DAYS[range]
	const facts = yield* accountFacts(account, days, now)
	const definitions = yield* db.run(SQLite.from(schema.customerMetricDefinitionsTable).select())
	const today = dayOf(now)
	const variable = metricKeys.includes("variable_mrr") ? yield* variableMrrSeries(account, today, days) : []
	return metricKeys.map((key): MetricSeries => {
		const definition = definitions.find((row) => row.key === key)
		if (key === "variable_mrr")
			return { metricKey: key, name: "Variable MRR", unit: "minor", points: variable, limit: null }
		// The newest day's limit: a feature that has since stopped recording one has none now.
		const history = facts.metrics.get(key) ?? []
		return {
			metricKey: key,
			name: definition?.name ?? key,
			unit: definition?.customUnit ?? definition?.unit ?? null,
			points: seriesOf(facts, key, today, days, definition?.aggregation),
			limit: history[history.length - 1]?.limitValue ?? null,
		}
	})
})

/** Contacts with their activity status and 30 days of events + sessions. */
const contactRows = (contacts: ReadonlyArray<schema.CustomerContact>, now: Date) =>
	Effect.gen(function* () {
		if (contacts.length === 0) return []
		const db = yield* Database.Database
		const today = dayOf(now)
		const from = addDays(today, -29)
		const rows = yield* db.run(
			SQLite.from(schema.customerActivityDailyTable)
				.select()
				.where(($) => [
					inList(
						$.contactId,
						contacts.map((contact) => contact.id),
					),
					$.day.gte(from),
				]),
		)
		return contacts.map((contact): ContactRow => {
			const own = rows.filter((row) => row.contactId === contact.id)
			const values = new Map(own.map((row) => [row.day, row.eventCount + row.sessionCount]))
			const active = own.some((row) => row.eventCount > 0 || row.sessionCount > 0 || row.signedIn)
			return {
				contact,
				status: active ? "active" : contact.firstActiveAt !== null ? "dormant" : "never_active",
				activity: dayRange(today, 30).map((day) => ({ day, value: values.get(day) ?? 0 })),
			}
		})
	})

export const contactsPage = Effect.fn("Customers.contactsPage")(function* (
	accountId: CustomerAccountId,
	request: { readonly cursor?: string; readonly limit?: number },
	now: Date,
) {
	const db = yield* Database.Database
	const page = pageOf(request)
	const contacts = yield* db.run(
		SQLite.from(schema.customerContactsTable)
			.select()
			.where(($) => [$.accountId.eq(accountId), $.deletedAt.isNull()])
			.orderBy(($) => [
				[$.firstActiveAt, "desc"],
				[$.name, "asc"],
				[$.id, "asc"],
			])
			.limit(page.limit + 1)
			.offset(page.offset),
	)
	const result = pageResult(contacts, page)
	return { items: yield* contactRows(result.items, now), nextCursor: result.nextCursor }
})

/** Midnight UTC of the first of `months` months before `day`'s month. */
const monthsBefore = (day: Day, months: number): Day => {
	const date = new Date(`${day.slice(0, 8)}01T00:00:00.000Z`)
	date.setUTCMonth(date.getUTCMonth() - months)
	return dayOf(date)
}

/** What an account paid (its paid invoices' lines, without tax): 30 days, 12 months, by month. */
const accountRevenue = (account: schema.CustomerAccount, basis: RevenueBasis, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const today = dayOf(now)
		const first = monthsBefore(today, 12)
		const paid = yield* db.run(
			SQLite.from(schema.customerInvoicesTable)
				.select(
					"status",
					"currency",
					"issuedAt",
					"paidAt",
					"amountPaidMinor",
					"servicePeriodStart",
					"lines",
				)
				.where(($) => [
					$.accountId.eq(account.id),
					$.status.eq("paid"),
					$.currency.eq(account.currency),
					$.paidAt.gte(new Date(`${first}T00:00:00.000Z`)),
					$.paidAt.lte(now),
				]),
		)
		const last30Days = emptySplit()
		const last12Months = emptySplit()
		const byMonth = new Map<Day, RevenueSplit>(
			Array.from({ length: 13 }, (_, index) => [monthsBefore(today, 12 - index), emptySplit()]),
		)
		const since30 = new Date(`${addDays(today, -29)}T00:00:00.000Z`)
		const since12 = new Date(`${addDays(today, -364)}T00:00:00.000Z`)
		for (const invoice of paid) {
			if (invoice.paidAt === null) continue
			if (invoice.paidAt >= since30) addRevenue(last30Days, invoice, basis)
			if (invoice.paidAt >= since12) addRevenue(last12Months, invoice, basis)
			const month = byMonth.get(`${dayOf(invoice.paidAt).slice(0, 8)}01`)
			if (month !== undefined) addRevenue(month, invoice, basis)
		}
		return {
			last30Days,
			last12Months,
			byMonth: [...byMonth].map(([start, split]): RevenueBucket => ({ start, ...split })),
		}
	})

/** Invoices with what their lines bill by class (any status; null without lines). */
export const invoiceRows = (invoices: ReadonlyArray<schema.CustomerInvoice>) =>
	Effect.gen(function* () {
		const basis = yield* loadRevenueBasis
		return invoices.map((invoice) => {
			if (invoice.lines === null) return { invoice, revenue: null }
			const split = emptySplit()
			// Its lines whatever its status: what it bills, not what was collected.
			addRevenue(split, { ...invoice, amountPaidMinor: 0 } satisfies BilledInvoice, basis)
			return { invoice, revenue: split }
		})
	})

export const accountDetail = Effect.fn("Customers.accountDetail")(function* (
	account: schema.CustomerAccount,
	now: Date,
) {
	const db = yield* Database.Database
	const today = dayOf(now)
	const refs = yield* db.run(
		SQLite.from(schema.customerExternalRefsTable)
			.select()
			.where(($) => [$.accountId.eq(account.id), $.entityType.eq("account")]),
	)
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [$.accountId.eq(account.id)])
			.orderBy(($) => [[$.startedAt, "desc"]])
			.limit(50),
	)
	const invoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select()
			.where(($) => [$.accountId.eq(account.id), $.status.in_("open", "upcoming")])
			.orderBy(($) => [[$.dueAt, "asc"]]),
	)
	const health = yield* db.first(
		SQLite.from(schema.customerHealthDailyTable)
			.select()
			.where(($) => [$.accountId.eq(account.id)])
			.orderBy(($) => [[$.day, "desc"]])
			.limit(1),
	)
	const facts = yield* accountFacts(account, 90, now)
	const contacts = yield* db.run(
		SQLite.from(schema.customerContactsTable)
			.select()
			.where(($) => [$.accountId.eq(account.id), $.deletedAt.isNull()]),
	)
	// Who to reach: the most active in 30 days, then admins.
	const activeDays = new Map<string, number>()
	for (const [day, users] of facts.activity) {
		if (day < addDays(today, -29)) continue
		for (const contact of users.keys()) activeDays.set(contact, (activeDays.get(contact) ?? 0) + 1)
	}
	const isAdmin = (contact: schema.CustomerContact) => /admin|owner/i.test(contact.role ?? "")
	const reach = [...contacts]
		.sort(
			(a, b) =>
				(activeDays.get(b.id) ?? 0) - (activeDays.get(a.id) ?? 0) ||
				Number(isAdmin(b)) - Number(isAdmin(a)),
		)
		.filter((contact) => (activeDays.get(contact.id) ?? 0) > 0 || isAdmin(contact))
		.slice(0, 5)
	const events = yield* db.run(
		SQLite.from(schema.customerEventsTable)
			.select()
			.where(($) => [$.accountId.eq(account.id)])
			.orderBy(($) => [
				[$.occurredAt, "desc"],
				[$.createdAt, "desc"],
			])
			.limit(10),
	)
	const live = subscriptions.filter((sub) => sub.status !== "canceled")
	const basis = yield* loadRevenueBasis
	return {
		revenue: yield* accountRevenue(account, basis, now),
		subscriptionMrr: subscriptions.map((sub) => ({
			subscriptionId: sub.id,
			mrrMinor: recurringMrrOf(sub, basis),
		})),
		account,
		refs,
		subscriptions: [...live, ...subscriptions.filter((sub) => sub.status === "canceled")],
		upcomingInvoice: invoices.find((invoice) => invoice.status === "upcoming") ?? null,
		openInvoices: invoices.filter((invoice) => invoice.status === "open"),
		health: Option.match(health, { onNone: () => null, onSome: (row) => row.breakdown }),
		healthSeries: seriesOf(facts, "health_score", today, 90),
		healthScores: facts.health
			.filter((point) => point.day > addDays(today, -90))
			.map((point) => ({ day: point.day, score: point.score })),
		activeUsersSeries: seriesOf(facts, "active_users", today, 30),
		contactsToReach: yield* contactRows(reach, now),
		recentEvents: events,
	}
})

/** One metric's last `days` values for many accounts. */
export const sparklines = Effect.fn("Customers.sparklines")(function* (
	accountIds: ReadonlyArray<CustomerAccountId>,
	metricKey: string,
	days: number,
	now: Date,
) {
	const db = yield* Database.Database
	const today = dayOf(now)
	const count = Math.min(90, Math.max(1, days))
	const from = addDays(today, -(count - 1))
	const ids = accountIds.slice(0, 200)
	if (ids.length === 0) return []
	const series = new Map<CustomerAccountId, Map<Day, number>>(ids.map((id) => [id, new Map()]))
	const set = (accountId: CustomerAccountId, day: Day, value: number) =>
		series.get(accountId)?.set(day, value)
	switch (metricKey) {
		case "active_users":
		case "active_users_30d": {
			const rolling = metricKey === "active_users_30d"
			const rows = yield* db.run(
				SQLite.from(schema.customerActivityDailyTable)
					.select("accountId", "contactId", "day")
					.where(($) => [
						inList($.accountId, ids),
						$.day.gte(rolling ? addDays(from, -29) : from),
						isActive($),
					]),
			)
			// Per account, each day's active contacts; a 30-day window slides over them, counting
			// each contact's active days inside it.
			const byAccount = new Map<CustomerAccountId, Map<Day, Array<string>>>()
			for (const row of rows) {
				const byDay = byAccount.get(row.accountId) ?? new Map<Day, Array<string>>()
				const contacts = byDay.get(row.day)
				if (contacts === undefined) byDay.set(row.day, [row.contactId])
				else contacts.push(row.contactId)
				byAccount.set(row.accountId, byDay)
			}
			const width = rolling ? 30 : 1
			for (const [accountId, byDay] of byAccount) {
				const inWindow = new Map<string, number>()
				const shift = (day: Day, by: 1 | -1) => {
					for (const contact of byDay.get(day) ?? []) {
						const active = (inWindow.get(contact) ?? 0) + by
						if (active === 0) inWindow.delete(contact)
						else inWindow.set(contact, active)
					}
				}
				// The window of the first day, but that day itself.
				for (const day of dayRange(addDays(from, -1), width - 1)) shift(day, 1)
				for (const day of dayRange(today, count)) {
					shift(day, 1)
					set(accountId, day, inWindow.size)
					shift(addDays(day, -(width - 1)), -1)
				}
			}
			break
		}
		case "mrr": {
			const accounts = yield* db.run(
				SQLite.from(schema.customerAccountsTable)
					.select()
					.where(($) => [inList($.id, ids)]),
			)
			const movements = yield* db.run(
				SQLite.from(schema.customerMrrMovementsTable)
					.select()
					.where(($) => [inList($.accountId, ids)])
					.orderBy(($) => [[$.day, "asc"]]),
			)
			const movementsOf = new Map<CustomerAccountId, Array<schema.CustomerMrrMovement>>()
			for (const row of movements) {
				const list = movementsOf.get(row.accountId)
				if (list === undefined) movementsOf.set(row.accountId, [row])
				else list.push(row)
			}
			for (const account of accounts) {
				const own = movementsOf.get(account.id) ?? []
				for (const point of mrrSeries(own, account.mrrMinor, today, count))
					set(account.id, point.day, point.value)
			}
			break
		}
		case "health_score": {
			const rows = yield* db.run(
				SQLite.from(schema.customerHealthDailyTable)
					.select("accountId", "day", "score")
					.where(($) => [inList($.accountId, ids), $.day.gte(from)]),
			)
			for (const row of rows) set(row.accountId, row.day, row.score ?? 0)
			break
		}
		default: {
			const rows = yield* db.run(
				SQLite.from(schema.customerMetricDailyTable)
					.select("accountId", "day", "value")
					.where(($) => [inList($.accountId, ids), $.metricKey.eq(metricKey), $.day.gte(from)]),
			)
			for (const row of rows) set(row.accountId, row.day, row.value)
		}
	}
	return ids.map((accountId) => ({
		accountId,
		values: dayRange(today, count).map((day) => series.get(accountId)?.get(day) ?? 0),
	}))
})
