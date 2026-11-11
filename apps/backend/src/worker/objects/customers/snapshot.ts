/**
 * Loads what compute and the dry runs evaluate (`./facts.ts`): the org-wide part once
 * (`loadBase`), then the live accounts in chunks (`loadAccounts`), each with its contacts,
 * activity over the window the rules need, billing, metrics, MRR movements and a month of health
 * history, plus the account fields compute derives from them (`rollupAccount`, §4.2).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type CustomerProvider,
	type Day,
	type HealthBreakdown,
	type HealthSettings,
	type LifecycleStage,
	MAX_WINDOW_DAYS,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { type RuleInput, activityWindowDays } from "./evaluate"
import {
	type AccountFacts,
	activeUsersIn,
	billed,
	type ContactFacts,
	type HealthPoint,
	type MetricPoint,
	type OrgFacts,
} from "./facts"
import { inList } from "./sql"
import { addDays, dayOf, dayRange, daysBetween } from "./time"

export const ACTIVE = Database.sql`("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`

/** The account fields compute owns, derived from its subscriptions, contacts and activity. */
export interface Rollup {
	readonly mrrMinor: number
	readonly currency: string
	/** Whose subscriptions `mrrMinor` counts (`billingProviderOf`); null without any. */
	readonly mrrSource: CustomerProvider | null
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

/** What a snapshot knows about the whole org. */
export interface SnapshotBase {
	readonly org: OrgFacts
	readonly settings: schema.CustomerSettings
	readonly health: HealthSettings
	readonly rules: ReadonlyArray<schema.CustomerSignalRule>
	/**
	 * Usage data is live: an activity source is connected (not in error or disconnected), or, with
	 * no activity connection at all, some contact was ever active.
	 */
	readonly hasActivityData: boolean
	/** Billing data exists (a billing source, or subscriptions). */
	readonly hasBillingData: boolean
	/** Autumn's subscriptions can count for MRR; each account's source is `billingProviderOf`'s. */
	readonly autumnReady: boolean
	/** The live accounts, loaded in chunks (`loadAccounts`). */
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	/** The first day of activity loaded (the rules' window). */
	readonly from: Day
	/** `inactive` rules' prior windows (days). */
	readonly priorWindows: ReadonlyArray<number>
}

/** The org and one chunk of its accounts. */
export interface Snapshot extends SnapshotBase {
	readonly accounts: ReadonlyArray<AccountSnapshot>
	/** The accounts' unclosed signals. */
	readonly signals: ReadonlyArray<schema.CustomerSignal>
	/** Today's stored health breakdowns, so an unchanged one is not written again. */
	readonly todayHealth: ReadonlyMap<CustomerAccountId, HealthBreakdown>
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const startOf = (day: Day) => new Date(`${day}T00:00:00.000Z`)

/** A paid subscription: it has MRR, or bills on usage MRR cannot capture (`billsByUsage`). */
const pays = (sub: schema.CustomerSubscription) => sub.mrrMinor > 0 || sub.billsByUsage

/** The fields compute derives for one account (pure). */
export const rollupAccount = (input: {
	readonly account: schema.CustomerAccount
	/** The billing provider's (`mrrSource`). */
	readonly subscriptions: ReadonlyArray<schema.CustomerSubscription>
	readonly mrrSource: CustomerProvider | null
	readonly contacts: ReadonlyArray<ContactFacts>
	readonly activity: AccountFacts["activity"]
	readonly lastActiveDay: Day | null
	readonly currency: string
	readonly now: Date
	readonly today: Day
}): Rollup => {
	const { account, subscriptions, now, today, currency } = input
	const live = subscriptions.filter((sub) => sub.status !== "canceled")
	const paying = live.filter(billed)
	const mrrMinor = sum(paying.filter((sub) => sub.currency === currency).map((sub) => sub.mrrMinor))
	// Paying in any currency (MRR counts only the reporting currency's; `attributes.foreignMrr` the rest),
	// or on usage at MRR 0: never `churned` or `lead` for want of MRR.
	const paid = paying.some(pays)
	const foreign = paying.filter((sub) => sub.currency !== currency)
	const trialing = live.filter((sub) => sub.status === "trialing")
	const top = [...paying].sort((a, b) => b.mrrMinor - a.mrrMinor)[0] ?? trialing[0] ?? live[0]
	const trialEnds = trialing.map((sub) => sub.trialEndsAt).filter((date) => date !== null)
	const derived: LifecycleStage = live.some((sub) => sub.status === "past_due" || sub.status === "unpaid")
		? "past_due"
		: paid
			? "active"
			: trialing.length > 0
				? "trialing"
				: account.customerSince !== null ||
					  subscriptions.some((sub) => pays(sub) && sub.status === "canceled")
					? "churned"
					: "lead"
	const paidStarts = subscriptions
		.filter((sub) => pays(sub) && sub.status !== "trialing")
		.map((sub) => sub.trialEndsAt ?? sub.startedAt)
		.filter((date) => date !== null)
		.map((date) => date.getTime())
	const customerSince =
		account.customerSince ??
		(paid ? new Date(paidStarts.length > 0 ? Math.min(...paidStarts) : now.getTime()) : null)
	const canceled = subscriptions.map((sub) => sub.canceledAt?.getTime() ?? 0)
	const churnedAt =
		derived === "churned"
			? (account.churnedAt ?? new Date(Math.max(...canceled, 0) || now.getTime()))
			: paid
				? null
				: account.churnedAt

	// Usage: 30-day active users, the 7-day vs prior 28-day daily average (ending yesterday: today
	// is still filling in), the champion.
	const dau = (day: Day) => input.activity.get(day)?.size ?? 0
	const yesterday = addDays(today, -1)
	const recent = sum(dayRange(yesterday, 7).map(dau)) / 7
	const baseline = sum(dayRange(addDays(yesterday, -7), 28).map(dau)) / 28
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
	const lastActive = input.contacts
		.flatMap((contact) =>
			contact.lastActiveDay === null ? [] : [{ id: contact.id, day: contact.lastActiveDay }],
		)
		.sort((a, b) => (a.day < b.day ? 1 : -1))[0]

	return {
		mrrMinor,
		currency,
		mrrSource: input.mrrSource,
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

const ACTIVITY_PROVIDERS: ReadonlySet<CustomerProvider> = new Set(["clerk", "maple"])

const BILLING_PROVIDERS: ReadonlyArray<CustomerProvider> = ["stripe", "autumn"]

/**
 * Whose subscriptions count for one account's MRR, from the providers it has subscriptions of (any
 * status): Autumn once its connection finished its first import (until then its data is partial)
 * and it bills the account, else Stripe (a customer Autumn does not know, or billed in Stripe
 * outside it). An account with Autumn's and none of Stripe's keeps Autumn's either way, so a
 * disconnect does not zero its MRR.
 */
export const billingProviderOf = (
	autumnReady: boolean,
	providers: ReadonlySet<CustomerProvider>,
): CustomerProvider =>
	providers.has("autumn") && (autumnReady || !providers.has("stripe")) ? "autumn" : "stripe"

/** Billing subscriptions by account: the account's source (`billingProviderOf`) and its subscriptions. */
export const billingByAccount = (
	autumnReady: boolean,
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
) =>
	new Map(
		[...groupBy(subscriptions, (sub) => sub.accountId)].map(([accountId, subs]) => {
			const source = billingProviderOf(autumnReady, new Set(subs.map((sub) => sub.provider)))
			return [accountId, { source, subscriptions: subs.filter((sub) => sub.provider === source) }]
		}),
	)

/** Accounts loaded (and their activity held in memory) at a time. */
const ACCOUNT_CHUNK = 250

/** Days of health history the rules read (`health_drop`'s window, its 30-day series). */
const HEALTH_DAYS = MAX_WINDOW_DAYS + 1

export const accountChunks = <A>(items: ReadonlyArray<A>, size = ACCOUNT_CHUNK) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	)

/**
 * The org-wide part of a snapshot, and the live accounts' ids: the accounts themselves load in
 * chunks (`loadAccounts`), so memory holds one chunk's activity at a time.
 */
export const loadBase = Effect.fn("Customers.loadBase")(function* (
	now: Date,
	options?: {
		/** The rules whose windows set the activity loaded (a dry run's draft); by default the enabled ones. */
		readonly windowRules?: ReadonlyArray<RuleInput>
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
	// A connection in error (bad credentials) is not a source to rely on: its templates match nothing.
	const connected = new Set(
		connections
			.filter((connection) => connection.status === "active")
			.map((connection) => connection.provider),
	)
	const anySubscription = yield* db.first(
		SQLite.from(schema.customerSubscriptionsTable)
			.select("id")
			.where(($) => [inList($.provider, BILLING_PROVIDERS)])
			.limit(1),
	)
	const rules = yield* db.run(
		SQLite.from(schema.customerSignalRulesTable)
			.select()
			.where(($) => [$.deletedAt.isNull(), $.enabled.eq(true)]),
	)
	const windowRules: ReadonlyArray<RuleInput> = options?.windowRules ?? rules
	const accountIds = (yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull()])
			.orderBy(($) => [[$.id, "asc"]]),
	)).map((row) => row.id)
	const definitions = yield* db.run(
		SQLite.from(schema.customerMetricDefinitionsTable).select("key", "name", "aggregation"),
	)
	const activityConnections = connections.filter((connection) =>
		ACTIVITY_PROVIDERS.has(connection.provider),
	)
	const anyActivity = yield* db.first(
		SQLite.from(schema.customerContactsTable)
			.select("id")
			.where(($) => [$.lastActiveDay.isNotNull()])
			.limit(1),
	)
	return {
		org: {
			now,
			today,
			connected,
			metricNames: new Map(definitions.map((definition) => [definition.key, definition.name])),
			metricAggregations: new Map(
				definitions.map((definition) => [definition.key, definition.aggregation]),
			),
			currency,
		},
		settings,
		health: settings.health,
		rules,
		// Stale rows of a disconnected source must not keep decaying everyone's usage score.
		hasActivityData:
			activityConnections.length > 0
				? activityConnections.some((connection) => connection.status === "active")
				: Option.isSome(anyActivity),
		hasBillingData: connected.has("stripe") || connected.has("autumn") || Option.isSome(anySubscription),
		autumnReady: connections.some(
			(connection) =>
				connection.provider === "autumn" &&
				connection.status !== "disconnected" &&
				connection.backfilledAt !== null,
		),
		accountIds,
		from: addDays(today, -(activityWindowDays(windowRules) - 1)),
		priorWindows: [
			...new Set(
				windowRules.flatMap((rule) =>
					rule.config._tag === "inactive" ? [rule.config.priorWindowDays] : [],
				),
			),
		],
	} satisfies SnapshotBase
})

/** `ids`' accounts (the live ones) with everything compute and the dry runs evaluate. */
export const loadAccounts = Effect.fn("Customers.loadAccounts")(function* (
	base: SnapshotBase,
	ids: ReadonlyArray<CustomerAccountId>,
) {
	const db = yield* Database.Database
	const { now, today, currency } = base.org
	const { from, priorWindows } = base
	const idList = JSON.stringify(ids)
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select()
			.where(($) => [inList($.id, ids), $.deletedAt.isNull()]),
	)
	const contacts = yield* db.run(
		SQLite.from(schema.customerContactsTable)
			.select("id", "accountId", "name", "email", "role", "firstActiveAt", "lastActiveDay")
			.where(($) => [inList($.accountId, ids), $.deletedAt.isNull()]),
	)
	const activity = (yield* db.query(
		Database.sql`SELECT "accountId", "contactId", "day", "eventCount" FROM "customer_activity_daily"
			WHERE "accountId" IN (SELECT value FROM json_each(${idList})) AND "day" >= ${from} AND ${ACTIVE}`,
	)) as ReadonlyArray<{
		accountId: CustomerAccountId
		contactId: CustomerContactId
		day: Day
		eventCount: number
	}>

	const contactsBy = groupBy(contacts, (contact) => contact.accountId)
	const activityBy = groupBy(activity, (row) => row.accountId)
	// The last active day over the live contacts and the activity the rollups count (a removed
	// contact's recent days included), so engagement and active users agree.
	const lastActiveDayBy = new Map<CustomerAccountId, Day>()
	const seen = (accountId: CustomerAccountId, last: Day | null) => {
		const current = lastActiveDayBy.get(accountId)
		if (last !== null && (current === undefined || last > current)) lastActiveDayBy.set(accountId, last)
	}
	for (const contact of contacts) seen(contact.accountId, contact.lastActiveDay)
	for (const row of activity) seen(row.accountId, row.day)

	// `inactive`'s "active users before": distinct users over the window ending on each account's
	// last active day. From the loaded rows when the window covers it; else one indexed query over
	// the accounts quiet for longer (`customer_activity_account_day_idx`).
	const priorActive = new Map<number, Map<CustomerAccountId, number>>()
	for (const days of priorWindows) {
		const counts = new Map<CustomerAccountId, number>()
		const older: Record<string, Day> = {}
		for (const [accountId, last] of lastActiveDayBy) {
			const start = addDays(last, -(days - 1))
			if (start < from) {
				older[accountId] = addDays(last, -days)
				continue
			}
			const users = new Set<CustomerContactId>()
			for (const row of activityBy.get(accountId) ?? []) {
				if (row.day >= start && row.day <= last) users.add(row.contactId)
			}
			counts.set(accountId, users.size)
		}
		if (Object.keys(older).length > 0) {
			const rows = (yield* db.query(
				Database.sql`SELECT a."accountId" AS "accountId", count(DISTINCT a."contactId") AS "count"
				FROM json_each(${JSON.stringify(older)}) j
				JOIN "customer_activity_daily" a ON a."accountId" = j.key AND a."day" > j.value
				WHERE (a."eventCount" > 0 OR a."sessionCount" > 0 OR a."signedIn" = 1)
				GROUP BY a."accountId"`,
			)) as ReadonlyArray<{ accountId: CustomerAccountId; count: number }>
			for (const row of rows) counts.set(row.accountId, Number(row.count))
		}
		priorActive.set(days, counts)
	}
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [inList($.accountId, ids), inList($.provider, BILLING_PROVIDERS)]),
	)
	// Invoices come from Stripe only (Autumn bills through it).
	const openInvoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select()
			.where(($) => [inList($.accountId, ids), $.status.eq("open"), $.provider.eq("stripe")]),
	)
	const metrics = yield* db.run(
		SQLite.from(schema.customerMetricDailyTable)
			.select()
			.where(($) => [inList($.accountId, ids), $.day.gte(from)])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const movements = yield* db.run(
		SQLite.from(schema.customerMrrMovementsTable)
			.select()
			.where(($) => [inList($.accountId, ids)])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const health = yield* db.run(
		SQLite.from(schema.customerHealthDailyTable)
			.select("accountId", "day", "score", "status")
			.where(($) => [inList($.accountId, ids), $.day.gte(addDays(today, -HEALTH_DAYS))])
			.orderBy(($) => [[$.day, "asc"]]),
	)
	const todayHealth = yield* db.run(
		SQLite.from(schema.customerHealthDailyTable)
			.select("accountId", "breakdown")
			.where(($) => [inList($.accountId, ids), $.day.eq(today)]),
	)
	const signals = yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select()
			.where(($) => [inList($.accountId, ids), $.closedAt.isNull()]),
	)

	const billingBy = billingByAccount(base.autumnReady, subscriptions)
	const invoicesBy = groupBy(openInvoices, (invoice) => invoice.accountId)
	const metricsBy = groupBy(metrics, (row) => row.accountId)
	const movementsBy = groupBy(movements, (row) => row.accountId)
	const healthBy = groupBy(health, (row) => row.accountId)

	const snapshots = accounts.map((stored): AccountSnapshot => {
		const own = contactsBy.get(stored.id) ?? []
		const accountContacts: Array<ContactFacts> = own.map((contact) => ({
			id: contact.id,
			name: contact.name,
			email: contact.email,
			role: contact.role,
			firstActiveAt: contact.firstActiveAt,
			lastActiveDay: contact.lastActiveDay,
		}))
		const byDay = new Map<Day, Map<CustomerContactId, number>>()
		for (const row of activityBy.get(stored.id) ?? []) {
			const day = byDay.get(row.day) ?? new Map<CustomerContactId, number>()
			day.set(row.contactId, Number(row.eventCount))
			byDay.set(row.day, day)
		}
		const lastActiveDay = lastActiveDayBy.get(stored.id) ?? null
		const billing = billingBy.get(stored.id)
		const accountSubs = billing?.subscriptions ?? []
		const rollup = rollupAccount({
			account: stored,
			subscriptions: accountSubs,
			mrrSource: billing?.source ?? null,
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
				everActiveContacts: own.filter((contact) => contact.firstActiveAt !== null).length,
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
		...base,
		accounts: snapshots,
		signals,
		todayHealth: new Map(todayHealth.map((row) => [row.accountId, row.breakdown])),
	} satisfies Snapshot
})
