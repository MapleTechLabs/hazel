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
	OverviewResult,
} from "@hazel/domain/customers"
import { HealthStatus } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { type AccountFacts, type HealthPoint, type MetricPoint, mrrSeries, seriesOf } from "./facts"
import { inList } from "./sql"
import { addDays, dayOf, dayRange } from "./time"

const ACTIVE = Database.sql`("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`

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
	const stickiness = (w: number, m: number) => (m === 0 ? 0 : Math.round((w / m) * 1000) / 10)

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
		grouped.set(key, [...(grouped.get(key) ?? []), day])
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
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "name", "logoUrl", "planName", "mrrMinor", "healthStatus")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const healthDistribution: Array<HealthDistributionRow> = HealthStatus.literals.map((status) => {
		const rows = accounts.filter((account) => account.healthStatus === status)
		return { status, count: rows.length, mrrMinor: rows.reduce((sum, row) => sum + row.mrrMinor, 0) }
	})
	const accountById = new Map(accounts.map((account) => [account.id, account]))

	// Movers: average daily active users in the range vs the one before.
	const moverDays = Math.min(days, 90)
	const moverStart = addDays(today, -(moverDays - 1))
	const moverPrevious = addDays(moverStart, -moverDays)
	const activity = (yield* db.query(
		Database.sql`SELECT "accountId", "day", count(*) AS "users" FROM "customer_activity_daily"
			WHERE "day" >= ${moverPrevious} AND ${ACTIVE} GROUP BY "accountId", "day"`,
	)) as ReadonlyArray<{ accountId: CustomerAccountId; day: Day; users: number }>
	const perAccount = new Map<CustomerAccountId, Map<Day, number>>()
	for (const row of activity) {
		const map = perAccount.get(row.accountId) ?? new Map<Day, number>()
		map.set(row.day, Number(row.users))
		perAccount.set(row.accountId, map)
	}
	const movers: Array<Mover> = []
	for (const [accountId, map] of perAccount) {
		const account = accountById.get(accountId)
		if (account === undefined) continue
		let currentSum = 0
		let previousSum = 0
		for (const [day, users] of map) {
			if (day >= moverStart) currentSum += users
			else previousSum += users
		}
		if (previousSum === 0) continue
		movers.push({
			accountId,
			name: account.name,
			logoUrl: account.logoUrl,
			changePct: Math.round(((currentSum - previousSum) / previousSum) * 1000) / 10,
			series: dayRange(today, moverDays).map((day) => ({ day, value: map.get(day) ?? 0 })),
		})
	}
	const gainers = movers
		.filter((mover) => mover.changePct > 0)
		.sort((a, b) => b.changePct - a.changePct)
		.slice(0, 5)
	const decliners = movers
		.filter((mover) => mover.changePct < 0)
		.sort((a, b) => a.changePct - b.changePct)
		.slice(0, 5)

	const brief = (movement: schema.CustomerMrrMovement, mrrMinor: number): AccountBrief | null => {
		const account = accountById.get(movement.accountId)
		return account === undefined
			? null
			: {
					accountId: account.id,
					name: account.name,
					logoUrl: account.logoUrl,
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

	const anyActivity = yield* db.first(SQLite.from(schema.customerActivityDailyTable).select("day").limit(1))
	const anyBilling = yield* db.first(SQLite.from(schema.customerSubscriptionsTable).select("id").limit(1))

	return {
		range,
		currency,
		bucket,
		kpis: {
			mrrMinor: kpi(value(current, "mrrMinor"), prior("mrrMinor")),
			payingCustomers: kpi(value(current, "payingAccounts"), prior("payingAccounts")),
			activeCustomers: kpi(value(current, "activeAccounts"), prior("activeAccounts")),
			wau: kpi(wau, prior("wau")),
			mau: kpi(mau, prior("mau")),
			stickinessPct: kpi(
				stickiness(wau, mau),
				previous === null ? null : stickiness(previous.wau, previous.mau),
			),
			logoChurn: kpi(churnCount(inCurrent), churnCount(inPrevious)),
			atRiskMrrMinor: kpi(value(current, "atRiskMrrMinor"), prior("atRiskMrrMinor")),
			nrrPct: nrrNow === null ? null : kpi(nrrNow, nrrBefore),
		},
		mrrMovements,
		activeUsers,
		healthDistribution,
		topMovers: { gainers, decliners },
		recentChurn,
		recentNew,
		hasData: { activity: Option.isSome(anyActivity), billing: Option.isSome(anyBilling) },
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
		const activity = (yield* db.query(
			Database.sql`SELECT "contactId", "day", "eventCount" FROM "customer_activity_daily"
				WHERE "accountId" = ${account.id} AND "day" >= ${from} AND ${ACTIVE}`,
		)) as ReadonlyArray<{ contactId: CustomerContactId; day: Day; eventCount: number }>
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
			metricMap.set(row.metricKey, [...(metricMap.get(row.metricKey) ?? []), row])
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
		} satisfies AccountFacts
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
	return metricKeys.map((key): MetricSeries => {
		const definition = definitions.find((row) => row.key === key)
		const limits = (facts.metrics.get(key) ?? []).filter((point) => point.limitValue !== null)
		return {
			metricKey: key,
			name: definition?.name ?? key,
			unit: definition?.unit ?? null,
			points: seriesOf(facts, key, today, days, definition?.aggregation),
			limit: limits[limits.length - 1]?.limitValue ?? null,
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
	return {
		account,
		refs,
		subscriptions: [...live, ...subscriptions.filter((sub) => sub.status === "canceled")],
		upcomingInvoice: invoices.find((invoice) => invoice.status === "upcoming") ?? null,
		openInvoices: invoices.filter((invoice) => invoice.status === "open"),
		health: Option.match(health, { onNone: () => null, onSome: (row) => row.breakdown }),
		healthSeries: seriesOf(facts, "health_score", today, 90),
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
	const idList = JSON.stringify(ids)
	switch (metricKey) {
		case "active_users":
		case "active_users_30d": {
			const rolling = metricKey === "active_users_30d"
			const rows = (yield* db.query(
				Database.sql`SELECT "accountId", "contactId", "day" FROM "customer_activity_daily"
					WHERE "accountId" IN (SELECT value FROM json_each(${idList})) AND "day" >= ${rolling ? addDays(from, -29) : from} AND ${ACTIVE}`,
			)) as ReadonlyArray<{ accountId: CustomerAccountId; contactId: string; day: Day }>
			const byAccount = new Map<CustomerAccountId, Array<{ contactId: string; day: Day }>>()
			for (const row of rows)
				byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row])
			for (const [accountId, list] of byAccount) {
				for (const day of dayRange(today, count)) {
					const lower = rolling ? addDays(day, -29) : day
					set(
						accountId,
						day,
						new Set(
							list
								.filter((row) => row.day >= lower && row.day <= day)
								.map((row) => row.contactId),
						).size,
					)
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
			for (const account of accounts) {
				const own = movements.filter((row) => row.accountId === account.id)
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
