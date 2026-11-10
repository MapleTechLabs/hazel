/**
 * Loads what compute and the dry runs evaluate (`./facts.ts`): every live account with its
 * contacts, activity over the window the rules need, billing, metrics, MRR movements and health
 * history, plus the account fields compute derives from them (`rollupAccount`, §4.2).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { CustomerProvider, Day, HealthSettings, LifecycleStage } from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { type RuleInput, activityWindowDays } from "./evaluate"
import {
	type AccountFacts,
	activeUsersIn,
	type ContactFacts,
	type HealthPoint,
	type MetricPoint,
	type OrgFacts,
} from "./facts"
import { addDays, dayOf, dayRange, daysBetween } from "./time"

const ACTIVE = Database.sql`("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`

/** The account fields compute owns, derived from its subscriptions, contacts and activity. */
export interface Rollup {
	readonly mrrMinor: number
	readonly currency: string
	readonly planName: string | null
	readonly trialEndsAt: Date | null
	readonly trialListMrrMinor: number | null
	readonly lifecycleStage: LifecycleStage
	readonly contactCount: number
	readonly activeUsers30d: number
	readonly activeUsersTrendPct: number | null
	readonly championContactId: CustomerContactId | null
	readonly championInactiveSince: Date | null
	readonly lastActiveContactId: CustomerContactId | null
	readonly lastActiveAt: Date | null
	readonly customerSince: Date | null
	readonly churnedAt: Date | null
	readonly attributes: Record<string, unknown>
}

export interface AccountSnapshot {
	/** The row as stored. */
	readonly stored: schema.CustomerAccount
	readonly rollup: Rollup
	/** Facts over the rolled-up account. */
	readonly facts: AccountFacts
}

export interface Snapshot {
	readonly org: OrgFacts
	readonly settings: schema.CustomerSettings
	readonly health: HealthSettings
	readonly rules: ReadonlyArray<schema.CustomerSignalRule>
	readonly accounts: ReadonlyArray<AccountSnapshot>
	/** Every unclosed signal. */
	readonly signals: ReadonlyArray<schema.CustomerSignal>
	/** Usage data exists (an activity source, or activity rows). */
	readonly hasActivityData: boolean
	/** Billing data exists (a billing source, or subscriptions). */
	readonly hasBillingData: boolean
	/** Whose subscriptions count for MRR: Autumn when connected, else Stripe. */
	readonly billingProvider: CustomerProvider
	/** Every active contact-day of the window, for the org's DAU/WAU/MAU. */
	readonly activityRows: ReadonlyArray<{ readonly contactId: CustomerContactId; readonly day: Day }>
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const startOf = (day: Day) => new Date(`${day}T00:00:00.000Z`)

/** The fields compute derives for one account (pure). */
export const rollupAccount = (input: {
	readonly account: schema.CustomerAccount
	readonly subscriptions: ReadonlyArray<schema.CustomerSubscription>
	readonly contacts: ReadonlyArray<ContactFacts>
	readonly activity: AccountFacts["activity"]
	readonly lastActiveDay: Day | null
	readonly currency: string
	readonly now: Date
	readonly today: Day
}): Rollup => {
	const { account, subscriptions, now, today, currency } = input
	const live = subscriptions.filter((sub) => sub.status !== "canceled")
	const paying = live.filter(
		(sub) => sub.status === "active" || sub.status === "past_due" || sub.status === "unpaid",
	)
	const mrrMinor = sum(paying.filter((sub) => sub.currency === currency).map((sub) => sub.mrrMinor))
	const foreign = paying.filter((sub) => sub.currency !== currency)
	const trialing = live.filter((sub) => sub.status === "trialing")
	const top = [...paying].sort((a, b) => b.mrrMinor - a.mrrMinor)[0] ?? trialing[0] ?? live[0]
	const trialEnds = trialing.map((sub) => sub.trialEndsAt).filter((date) => date !== null)
	const derived: LifecycleStage = live.some((sub) => sub.status === "past_due" || sub.status === "unpaid")
		? "past_due"
		: mrrMinor > 0
			? "active"
			: trialing.length > 0
				? "trialing"
				: account.customerSince !== null ||
					  subscriptions.some((sub) => sub.mrrMinor > 0 && sub.status === "canceled")
					? "churned"
					: "lead"
	const paidStarts = subscriptions
		.filter((sub) => sub.mrrMinor > 0 && sub.status !== "trialing")
		.map((sub) => sub.trialEndsAt ?? sub.startedAt)
		.filter((date) => date !== null)
		.map((date) => date.getTime())
	const customerSince =
		account.customerSince ??
		(mrrMinor > 0 ? new Date(paidStarts.length > 0 ? Math.min(...paidStarts) : now.getTime()) : null)
	const canceled = subscriptions.map((sub) => sub.canceledAt?.getTime() ?? 0)
	const churnedAt =
		derived === "churned"
			? (account.churnedAt ?? new Date(Math.max(...canceled, 0) || now.getTime()))
			: mrrMinor > 0
				? null
				: account.churnedAt

	// Usage: 30-day active users, the 7-day vs prior 28-day daily average, the champion.
	const dau = (day: Day) => input.activity.get(day)?.size ?? 0
	const recent = sum(dayRange(today, 7).map(dau)) / 7
	const baseline = sum(dayRange(addDays(today, -7), 28).map(dau)) / 28
	const facts = { activity: input.activity } as AccountFacts
	const activeUsers30d = activeUsersIn(facts, addDays(today, -29), today)
	const totals = new Map<CustomerContactId, { days: number; events: number }>()
	for (const [day, contacts] of input.activity) {
		if (day < addDays(today, -29)) continue
		for (const [contact, events] of contacts) {
			const total = totals.get(contact) ?? { days: 0, events: 0 }
			totals.set(contact, { days: total.days + 1, events: total.events + events })
		}
	}
	const champion =
		[...totals.entries()].sort(([, a], [, b]) => b.days - a.days || b.events - a.events)[0]?.[0] ?? null
	const championLast = input.contacts.find((contact) => contact.id === champion)?.lastActiveDay ?? null
	const lastActive = [...input.contacts]
		.filter((contact) => contact.lastActiveDay !== null)
		.sort((a, b) => (a.lastActiveDay! < b.lastActiveDay! ? 1 : -1))[0]

	return {
		mrrMinor,
		currency,
		planName: top?.planName ?? null,
		trialEndsAt:
			trialEnds.length === 0 ? null : new Date(Math.min(...trialEnds.map((date) => date.getTime()))),
		trialListMrrMinor: trialing.length === 0 ? null : sum(trialing.map((sub) => sub.listMrrMinor ?? 0)),
		lifecycleStage: account.lifecycleStageOverride ?? derived,
		contactCount: input.contacts.length,
		activeUsers30d,
		activeUsersTrendPct: baseline === 0 ? null : Math.round(((recent - baseline) / baseline) * 1000) / 10,
		championContactId: champion,
		championInactiveSince:
			championLast !== null && daysBetween(championLast, today) >= 1 ? startOf(championLast) : null,
		lastActiveContactId: lastActive?.id ?? null,
		lastActiveAt: input.lastActiveDay === null ? null : startOf(input.lastActiveDay),
		customerSince,
		churnedAt,
		attributes:
			foreign.length === 0
				? Object.fromEntries(
						Object.entries(account.attributes).filter(([key]) => key !== "foreignMrr"),
					)
				: {
						...account.attributes,
						foreignMrr: Object.fromEntries(
							[...new Set(foreign.map((sub) => sub.currency))].map((code) => [
								code,
								sum(
									foreign.filter((sub) => sub.currency === code).map((sub) => sub.mrrMinor),
								),
							]),
						),
					},
	}
}

const groupBy = <A, K>(items: ReadonlyArray<A>, key: (item: A) => K) => {
	const groups = new Map<K, Array<A>>()
	for (const item of items) {
		const group = groups.get(key(item))
		if (group === undefined) groups.set(key(item), [item])
		else group.push(item)
	}
	return groups
}

export const loadSnapshot = Effect.fn("Customers.loadSnapshot")(function* (
	now: Date,
	options?: {
		/** Rules to evaluate besides the enabled ones (a dry run's draft): widens the windows. */
		readonly extraRules?: ReadonlyArray<RuleInput>
	},
) {
	const db = yield* Database.Database
	const today = dayOf(now)
	const settingsRow = yield* db.first(SQLite.from(schema.customerSettingsTable).select().limit(1))
	if (Option.isNone(settingsRow))
		return yield* Effect.die(new Error("Customers defaults are not installed"))
	const settings = settingsRow.value
	const currency = settings.reportingCurrency

	const connections = yield* db.run(SQLite.from(schema.customerConnectionsTable).select())
	const connected = new Set(
		connections
			.filter((connection) => connection.status !== "disconnected")
			.map((connection) => connection.provider),
	)
	const billingProvider: CustomerProvider = connected.has("autumn") ? "autumn" : "stripe"
	const rules = yield* db.run(
		SQLite.from(schema.customerSignalRulesTable)
			.select()
			.where(($) => [$.deletedAt.isNull(), $.enabled.eq(true)]),
	)
	const allRules: ReadonlyArray<RuleInput> = [...rules, ...(options?.extraRules ?? [])]
	const window = activityWindowDays(allRules)
	const from = addDays(today, -(window - 1))

	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select()
			.where(($) => [$.deletedAt.isNull()]),
	)
	const contacts = yield* db.run(
		SQLite.from(schema.customerContactsTable)
			.select("id", "accountId", "name", "email", "role", "firstActiveAt")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const activity = (yield* db.query(
		Database.sql`SELECT "accountId", "contactId", "day", "eventCount" FROM "customer_activity_daily"
			WHERE "day" >= ${from} AND ${ACTIVE}`,
	)) as ReadonlyArray<{
		accountId: CustomerAccountId
		contactId: CustomerContactId
		day: Day
		eventCount: number
	}>
	const lastActive = (yield* db.query(
		Database.sql`SELECT "contactId", "accountId", max("day") AS "last" FROM "customer_activity_daily"
			WHERE ${ACTIVE} GROUP BY "contactId", "accountId"`,
	)) as ReadonlyArray<{ contactId: CustomerContactId; accountId: CustomerAccountId; last: Day }>
	const everActive = (yield* db.query(
		Database.sql`SELECT "accountId", count(*) AS "count" FROM "customer_contacts"
			WHERE "deletedAt" IS NULL AND "firstActiveAt" IS NOT NULL GROUP BY "accountId"`,
	)) as ReadonlyArray<{ accountId: CustomerAccountId; count: number }>
	const priorWindows = [
		...new Set(
			allRules.flatMap((rule) =>
				rule.config._tag === "inactive" ? [rule.config.priorWindowDays] : [],
			),
		),
	]
	const priorActive = new Map<number, Map<CustomerAccountId, number>>()
	for (const days of priorWindows) {
		const rows = (yield* db.query(
			Database.sql`WITH "last" AS (
				SELECT "accountId", max("day") AS "last" FROM "customer_activity_daily" WHERE ${ACTIVE} GROUP BY "accountId"
			)
			SELECT a."accountId" AS "accountId", count(DISTINCT a."contactId") AS "count"
			FROM "customer_activity_daily" a JOIN "last" l ON l."accountId" = a."accountId"
			WHERE (a."eventCount" > 0 OR a."sessionCount" > 0 OR a."signedIn" = 1)
				AND a."day" > date(l."last", ${`-${days} days`})
			GROUP BY a."accountId"`,
		)) as ReadonlyArray<{ accountId: CustomerAccountId; count: number }>
		priorActive.set(days, new Map(rows.map((row) => [row.accountId, Number(row.count)])))
	}
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [$.provider.eq(billingProvider)]),
	)
	const openInvoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select()
			.where(($) => [$.status.eq("open")]),
	)
	const metrics = yield* db.run(
		SQLite.from(schema.customerMetricDailyTable)
			.select()
			.where(($) => [$.day.gte(from)])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const definitions = yield* db.run(
		SQLite.from(schema.customerMetricDefinitionsTable).select("key", "name"),
	)
	const movements = yield* db.run(
		SQLite.from(schema.customerMrrMovementsTable)
			.select()
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const health = yield* db.run(
		SQLite.from(schema.customerHealthDailyTable)
			.select("accountId", "day", "score", "status")
			.where(($) => [$.day.gte(from)])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const signals = yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select()
			.where(($) => [$.closedAt.isNull()]),
	)

	const contactsBy = groupBy(contacts, (contact) => contact.accountId)
	const activityBy = groupBy(activity, (row) => row.accountId)
	const lastBy = new Map(lastActive.map((row) => [row.contactId, row.last]))
	const lastActiveBy = groupBy(lastActive, (row) => row.accountId)
	const everBy = new Map(everActive.map((row) => [row.accountId, Number(row.count)]))
	const subsBy = groupBy(subscriptions, (sub) => sub.accountId)
	const invoicesBy = groupBy(openInvoices, (invoice) => invoice.accountId)
	const metricsBy = groupBy(metrics, (row) => row.accountId)
	const movementsBy = groupBy(movements, (row) => row.accountId)
	const healthBy = groupBy(health, (row) => row.accountId)

	const snapshots = accounts.map((stored): AccountSnapshot => {
		const accountContacts: Array<ContactFacts> = (contactsBy.get(stored.id) ?? []).map((contact) => ({
			id: contact.id,
			name: contact.name,
			email: contact.email,
			role: contact.role,
			firstActiveAt: contact.firstActiveAt,
			lastActiveDay: lastBy.get(contact.id) ?? null,
		}))
		const byDay = new Map<Day, Map<CustomerContactId, number>>()
		for (const row of activityBy.get(stored.id) ?? []) {
			const day = byDay.get(row.day) ?? new Map<CustomerContactId, number>()
			day.set(row.contactId, Number(row.eventCount))
			byDay.set(row.day, day)
		}
		const lastActiveDay = (lastActiveBy.get(stored.id) ?? []).reduce<Day | null>(
			(max, row) => (max === null || row.last > max ? row.last : max),
			null,
		)
		const accountSubs = subsBy.get(stored.id) ?? []
		const rollup = rollupAccount({
			account: stored,
			subscriptions: accountSubs,
			contacts: accountContacts,
			activity: byDay,
			lastActiveDay,
			currency,
			now,
			today,
		})
		const account: schema.CustomerAccount = { ...stored, ...rollup }
		const metricMap = new Map<string, Array<MetricPoint>>()
		for (const row of metricsBy.get(stored.id) ?? []) {
			const points = metricMap.get(row.metricKey) ?? []
			points.push({ day: row.day, value: row.value, limitValue: row.limitValue })
			metricMap.set(row.metricKey, points)
		}
		return {
			stored,
			rollup,
			facts: {
				account,
				stage: rollup.lifecycleStage,
				contacts: accountContacts,
				activity: byDay,
				lastActiveDay,
				everActiveContacts: everBy.get(stored.id) ?? 0,
				priorActive: new Map(
					priorWindows.map((days) => [days, priorActive.get(days)?.get(stored.id) ?? 0]),
				),
				subscriptions: accountSubs,
				openInvoices: invoicesBy.get(stored.id) ?? [],
				metrics: metricMap,
				movements: movementsBy.get(stored.id) ?? [],
				health: (healthBy.get(stored.id) ?? []).map((row): HealthPoint => ({
					day: row.day,
					score: row.score,
					status: row.status,
				})),
			},
		}
	})

	return {
		org: {
			now,
			today,
			connected,
			metricNames: new Map(definitions.map((definition) => [definition.key, definition.name])),
			currency,
		},
		settings,
		health: settings.health,
		rules,
		accounts: snapshots,
		signals,
		hasActivityData: connected.has("clerk") || connected.has("maple") || lastActive.length > 0,
		hasBillingData: connected.has("stripe") || connected.has("autumn") || subscriptions.length > 0,
		billingProvider,
		activityRows: activity.map((row) => ({ contactId: row.contactId, day: row.day })),
	} satisfies Snapshot
})
