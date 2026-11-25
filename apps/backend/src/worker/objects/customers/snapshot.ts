/**
 * Loads what compute and the rule dry run evaluate (`./facts.ts`): the org-wide part once
 * (`loadBase`), then the live accounts in chunks (`loadAccounts`), each with its contacts,
 * activity over the window the rules need, billing, metrics and MRR movements, plus the account
 * fields compute derives from them (`rollupAccount`, §4.2). A chunk holds whole groups of linked
 * accounts (`./groups.ts`): a primary's signals evaluate its group's combined facts
 * (`./group-facts.ts`).
 */
import {
	activityProviders,
	billingPreferenceOrder,
	billingProviders,
	firstImportProviders,
	invoiceProviders,
	usageInvoiceProviders,
} from "@hazel/customer-integrations"
import { Database, SQLite, schema } from "@hazel/db"
import {
	type CustomerProvider,
	type Day,
	ENVIRONMENT_TEMPLATES,
	type LifecycleStage,
	type SignalTemplate,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerContactId, CustomerSubscriptionId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { type RuleInput, activityWindowDays } from "./evaluate"
import { groupFacts, latest } from "./group-facts"
import {
	type AccountFacts,
	activeUsersIn,
	billed,
	type ContactFacts,
	type EndedPlanInvoice,
	endedPaying,
	type IssueSlaFacts,
	type MetricPoint,
	type OrgFacts,
	pays,
	type UnpaidEnd,
	unpaidEndOf,
	wasCustomer,
} from "./facts"
import { inList, isActive } from "./sql"
import { addDays, DAY_MS, dayOf, dayRange, daysBetween } from "@hazel/customer-integrations/kit/time"

/** A JSON key or value holding an account id. */
const accountIdText = schema.typed<CustomerAccountId>()(SQLite.text)

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
	/** When it stopped paying, if its plans ended on a failed payment (`unpaidEndOf`). */
	readonly unpaidSince: Date | null
	/**
	 * What signals evaluate: its own facts, its group's on a primary with environments, null on an
	 * environment of a primary (its primary's signals stand for it, but for `ENVIRONMENT_TEMPLATES`:
	 * see `evaluatedFor`).
	 */
	readonly evaluated: AccountFacts | null
}

/**
 * What a rule evaluates on each account. An environment template reads the account's own usage and
 * billing, under the customer's stage, scope and value (a free dev environment of a paying customer
 * is still covered, by the customer's subscriptions too); null where the primary's signal stands for the account.
 */
export const evaluatedFor = (accounts: ReadonlyArray<AccountSnapshot>) => {
	const byId = new Map(accounts.map((account) => [account.stored.id, account]))
	return (template: SignalTemplate, account: AccountSnapshot): AccountFacts | null => {
		if (!ENVIRONMENT_TEMPLATES.includes(template)) return account.evaluated
		const primaryId = account.stored.primaryAccountId
		const customer =
			account.evaluated ?? (primaryId === null ? undefined : byId.get(primaryId)?.evaluated)
		return {
			...(customer ?? account.facts),
			metrics: account.facts.metrics,
			ownSubscriptions: account.facts.subscriptions,
		}
	}
}

/** What a snapshot knows about the whole org. */
export interface SnapshotBase {
	readonly org: OrgFacts
	readonly settings: schema.CustomerSettings
	readonly rules: ReadonlyArray<schema.CustomerSignalRule>
	/**
	 * The billing sources needing a first import that can count for MRR (it is done, and a run
	 * succeeded since they were last connected), in registry order; each account's source is
	 * `billingProviderOf`'s.
	 */
	readonly billingReady: ReadonlyArray<CustomerProvider>
	/** The live accounts, loaded in chunks (`loadAccounts`). */
	readonly accountIds: ReadonlyArray<CustomerAccountId>
	/**
	 * The live accounts by customer: each group's primary first, then its environments; groups in
	 * their primary's id order. An environment whose primary is gone stands alone.
	 */
	readonly groups: ReadonlyArray<ReadonlyArray<CustomerAccountId>>
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
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const startOf = (day: Day) => new Date(`${day}T00:00:00.000Z`)

/** The plan to show among `subs` (live): the billed one with the most MRR, else a trial, else any. */
const topOf = (subs: ReadonlyArray<schema.CustomerSubscription>) =>
	subs.filter(billed).sort((a, b) => b.mrrMinor - a.mrrMinor)[0] ??
	subs.find((sub) => sub.status === "trialing") ??
	subs[0]

/** How far back usage billing averages (`usageMrrOf`): 3 months. */
export const USAGE_WINDOW_DAYS = 92

/** The usage component of one subscription's MRR, per month. */
export interface UsageMrr {
	readonly subscriptionId: CustomerSubscriptionId
	readonly mrrMinor: number
	readonly currency: string
}

/**
 * Usage billing on top of the plans' MRR, best effort: for each billed (`billed`) monthly
 * subscription of a source whose invoices carry usage (`usageFromInvoices`), the average of what its
 * paid invoices of the last 3 months (`USAGE_WINDOW_DAYS`) charged above its plan price (metered and
 * tiered prices, which the plan's MRR leaves out), over the invoices there are when fewer than 3. A
 * discount (paid below the plan) adds nothing. Any provider's account: another billing source may
 * bill through that one's subscriptions.
 */
export const usageMrrOf = (
	/** The account's, any provider. */
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	/** The account's paid invoices (`invoiceProviders`). */
	paidInvoices: ReadonlyArray<schema.CustomerInvoice>,
	now: Date,
): ReadonlyArray<UsageMrr> =>
	subscriptions.flatMap((sub) => {
		if (!usageInvoiceProviders.includes(sub.provider) || sub.interval !== "month" || !billed(sub))
			return []
		const recent = paidInvoices
			.filter(
				(invoice) =>
					invoice.subscriptionId === sub.id &&
					invoice.currency === sub.currency &&
					invoice.paidAt !== null &&
					invoice.paidAt <= now &&
					now.getTime() - invoice.paidAt.getTime() <= USAGE_WINDOW_DAYS * DAY_MS,
			)
			.sort((a, b) => Number(b.paidAt) - Number(a.paidAt))
			.slice(0, 3)
		if (recent.length === 0) return []
		const usage = sum(recent.map((invoice) => Math.max(0, invoice.amountPaidMinor - sub.mrrMinor)))
		const mrrMinor = Math.round(usage / recent.length)
		return mrrMinor === 0 ? [] : [{ subscriptionId: sub.id, mrrMinor, currency: sub.currency }]
	})

/** The fields compute derives for one account (pure). */
export const rollupAccount = (input: {
	readonly account: schema.CustomerAccount
	/** The billing provider's (`mrrSource`). */
	readonly subscriptions: ReadonlyArray<schema.CustomerSubscription>
	readonly mrrSource: CustomerProvider | null
	/** Its plans ended on a failed payment: past due while the invoice is open, else churned from it. */
	readonly unpaidEnd?: UnpaidEnd | null
	/** Add-on plan names (settings' `addOnPlans`): `planName` is a base plan's while there is one. */
	readonly addOnPlans: ReadonlyArray<string>
	/** Its usage billing per month (`usageMrrOf`), added on top of the plans' MRR. */
	readonly usageMrr: ReadonlyArray<UsageMrr>
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
	const mrrMinor =
		sum(paying.filter((sub) => sub.currency === currency).map((sub) => sub.mrrMinor)) +
		sum(input.usageMrr.filter((row) => row.currency === currency).map((row) => row.mrrMinor))
	// Paying in any currency (MRR counts only the reporting currency's; `attributes.foreignMrr` the rest),
	// or on usage at MRR 0: never `churned` or `lead` for want of MRR.
	const paid = paying.some(pays)
	const foreign = paying.filter((sub) => sub.currency !== currency)
	const trialing = live.filter((sub) => sub.status === "trialing")
	const addOns = new Set(input.addOnPlans)
	const named = live.filter((sub) => sub.planName !== null)
	const top = topOf(named.filter((sub) => !addOns.has(sub.planName ?? ""))) ?? topOf(named) ?? topOf(live)
	const trialEnds = trialing.map((sub) => sub.trialEndsAt).filter((date) => date !== null)
	const unpaidEnd = input.unpaidEnd ?? null
	const owing = unpaidEnd !== null && unpaidEnd.open.length > 0
	const derived: LifecycleStage = live.some((sub) => sub.status === "past_due" || sub.status === "unpaid")
		? "past_due"
		: paid
			? "active"
			: trialing.length > 0
				? "trialing"
				: account.customerSince !== null ||
					  subscriptions.some((sub) => wasCustomer(sub) && sub.status === "canceled")
					? owing
						? "past_due"
						: "churned"
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
			? (unpaidEnd?.since ?? account.churnedAt ?? new Date(Math.max(...canceled, 0) || now.getTime()))
			: paid || owing
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
	// A champion counts as gone quiet only after a week away, not a day off.
	const championGraceDays = 7
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
			championLast !== null && daysBetween(championLast, today) >= championGraceDays
				? startOf(championLast)
				: null,
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

const ACTIVITY_PROVIDERS: ReadonlySet<CustomerProvider> = new Set(activityProviders)

/** A day plus the longest pull interval (6 hours): a source silent for longer has stopped delivering. */
const STALE_AFTER_MS = 30 * 60 * 60_000

/**
 * An active connection whose pulls have not succeeded for `STALE_AFTER_MS` (or not yet at all): its
 * usage data is not live. One that never pulls (no `nextSyncAt`: the demo seed's, imported once)
 * delivers what it has.
 */
const stoppedDelivering = (connection: schema.CustomerConnection, now: Date) =>
	connection.nextSyncAt !== null &&
	(connection.lastSuccessAt === null || connection.lastSuccessAt.getTime() < now.getTime() - STALE_AFTER_MS)

/** Bills the account now: a live billed subscription that pays (not a trial, not a free plan). */
export const billsNow = (sub: schema.CustomerSubscription) => billed(sub) && pays(sub)

/**
 * Whose subscriptions count for one account's MRR, from its subscriptions (any status). Over the
 * billing sources holding some, best preference first: the first that bills the account now
 * (`billsNow`), one needing a first import only once that is done (until then its data is partial).
 * With none billing now, the one source that knows the customer held a plan (`wasCustomer`), once
 * it counts; else the source stored last run (`stored`), so a payer ending in one provider churns
 * there rather than switching; else the last preference. An account held by one source keeps it
 * either way, so a disconnect does not zero its MRR.
 */
export const billingProviderOf = (
	ready: ReadonlySet<CustomerProvider>,
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	stored: CustomerProvider | null,
): CustomerProvider => {
	const holding = billingPreferenceOrder.flatMap(({ provider, requiresFirstImport }) => {
		const subs = subscriptions.filter((sub) => sub.provider === provider)
		return subs.length === 0
			? []
			: [{ provider, subs, counts: !requiresFirstImport || ready.has(provider) }]
	})
	const last = holding[holding.length - 1]
	if (last === undefined) return billingPreferenceOrder[billingPreferenceOrder.length - 1].provider
	if (holding.length === 1) return last.provider
	const billing = holding.find(({ subs, counts }) => counts && subs.some(billsNow))
	if (billing !== undefined) return billing.provider
	const customers = holding.filter(({ subs }) => subs.some(wasCustomer))
	if (customers.length === 1 && customers[0].counts) return customers[0].provider
	return stored ?? last.provider
}

/**
 * Billing subscriptions by account: the account's source (`billingProviderOf`, given its stored
 * `mrrSource`) and its subscriptions.
 */
export const billingByAccount = (
	ready: ReadonlySet<CustomerProvider>,
	subscriptions: ReadonlyArray<schema.CustomerSubscription>,
	storedSources: ReadonlyMap<CustomerAccountId, CustomerProvider | null>,
) =>
	new Map(
		[...groupBy(subscriptions, (sub) => sub.accountId)].map(([accountId, subs]) => {
			const source = billingProviderOf(ready, subs, storedSources.get(accountId) ?? null)
			return [accountId, { source, subscriptions: subs.filter((sub) => sub.provider === source) }]
		}),
	)

/** The plan invoices (`invoiceProviders`) of the accounts whose paid plans all ended, for `unpaidEndOf`. */
export const endedPlanInvoices = Effect.fnUntraced(function* (
	billingBy: ReturnType<typeof billingByAccount>,
	accountIds: ReadonlyArray<CustomerAccountId>,
) {
	const ids = accountIds.filter((id) => endedPaying(billingBy.get(id)?.subscriptions ?? []))
	if (ids.length === 0) return new Map<CustomerAccountId, Array<EndedPlanInvoice>>()
	const db = yield* Database.Database
	const invoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select(
				"id",
				"accountId",
				"subscriptionId",
				"status",
				"issuedAt",
				"amountDueMinor",
				"amountPaidMinor",
				"attemptCount",
			)
			.where(($) => [
				inList($.accountId, ids),
				inList($.provider, invoiceProviders),
				$.status.neq("upcoming"),
				$.subscriptionId.isNotNull(),
			]),
	)
	return groupBy<EndedPlanInvoice, CustomerAccountId>(invoices, (invoice) => invoice.accountId)
})

/** Accounts loaded (and their activity held in memory) at a time. */
const ACCOUNT_CHUNK = 250

export const accountChunks = <A>(items: ReadonlyArray<A>, size = ACCOUNT_CHUNK) =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	)

/** Whole groups (`SnapshotBase.groups`) packed into chunks of up to `size` accounts (a larger group alone). */
export const groupChunks = (groups: SnapshotBase["groups"], size = ACCOUNT_CHUNK) => {
	const chunks: Array<Array<ReadonlyArray<CustomerAccountId>>> = []
	let count = 0
	for (const group of groups) {
		const last = chunks[chunks.length - 1]
		if (last === undefined || count + group.length > size) {
			chunks.push([group])
			count = group.length
		} else {
			last.push(group)
			count += group.length
		}
	}
	return chunks
}

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
	const active = connections.filter((connection) => connection.status === "active")
	const stale = new Set(
		active
			.filter((connection) => stoppedDelivering(connection, now))
			.map((connection) => connection.provider),
	)
	// A connection in error (bad credentials) is not a source to rely on, nor an activity source that
	// stopped delivering (its last activity would read as everyone going quiet): its templates match
	// nothing.
	const connected = new Set(
		active
			.map((connection) => connection.provider)
			.filter((provider) => !(ACTIVITY_PROVIDERS.has(provider) && stale.has(provider))),
	)
	const rules = yield* db.run(
		SQLite.from(schema.customerSignalRulesTable)
			.select()
			.where(($) => [$.deletedAt.isNull(), $.enabled.eq(true)]),
	)
	const windowRules: ReadonlyArray<RuleInput> = options?.windowRules ?? rules
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "primaryAccountId")
			.where(($) => [$.deletedAt.isNull()])
			.orderBy(($) => [[$.id, "asc"]]),
	)
	const accountIds = accounts.map((row) => row.id)
	const live = new Set(accountIds)
	const groups = new Map<CustomerAccountId, Array<CustomerAccountId>>()
	for (const { id, primaryAccountId } of accounts) {
		const primary = primaryAccountId !== null && live.has(primaryAccountId) ? primaryAccountId : id
		groups.set(primary, [...(groups.get(primary) ?? []), id])
	}
	const definitions = yield* db.run(
		SQLite.from(schema.customerMetricDefinitionsTable).select("key", "name", "aggregation", "provider"),
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
			staleMetrics: new Set(
				definitions
					.filter((definition) => definition.provider !== null && stale.has(definition.provider))
					.map((definition) => definition.key),
			),
			currency,
			attention: settings.attention,
		},
		settings,
		rules,
		// A reconnect keeps what it imported before, stale meanwhile: it counts again once the run the
		// reconnect started succeeds (`lastSuccessAt`, that run's start, not before `connectedAt`).
		billingReady: firstImportProviders.filter((provider) =>
			connections.some(
				(connection) =>
					connection.provider === provider &&
					connection.status !== "disconnected" &&
					connection.backfilledAt !== null &&
					(connection.lastSuccessAt === null || connection.lastSuccessAt >= connection.connectedAt),
			),
		),
		accountIds,
		groups: [...groups]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([primary, ids]) => [primary, ...ids.filter((id) => id !== primary)]),
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

/** `ids`' accounts (the live ones) with everything compute and the rule dry run evaluate. */
export const loadAccounts = Effect.fn("Customers.loadAccounts")(function* (
	base: SnapshotBase,
	ids: ReadonlyArray<CustomerAccountId>,
) {
	const db = yield* Database.Database
	const { now, today, currency } = base.org
	const { from, priorWindows } = base
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
	const activity = yield* db.run(
		SQLite.from(schema.customerActivityDailyTable)
			.select("accountId", "contactId", "day", "eventCount")
			.where(($) => [inList($.accountId, ids), $.day.gte(from), isActive($)]),
	)

	const contactsBy = groupBy(contacts, (contact) => contact.accountId)
	const activityBy = groupBy(activity, (row) => row.accountId)
	// The last active day over the live contacts and the activity the rollups count (a removed
	// contact's recent days included), so it agrees with active users.
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
			// Per account, its activity after `older[account]`.
			const rows = yield* db.run(
				SQLite.from(SQLite.jsonEach(older, { key: accountIdText, value: SQLite.text }), "j")
					.innerJoin(schema.customerActivityDailyTable, "a", (j, a) =>
						a.accountId.eq(j.key).and(a.day.gt(j.value)),
					)
					.select(($) => ({ accountId: $.a.accountId, count: SQLite.countDistinct($.a.contactId) }))
					.where(($) => [isActive($.a)])
					.groupBy("accountId"),
			)
			for (const row of rows) counts.set(row.accountId, row.count)
		}
		priorActive.set(days, counts)
	}
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [inList($.accountId, ids), inList($.provider, billingProviders)]),
	)
	// Invoices come only from the sources that hold them (`invoices`); others bill through those.
	const openInvoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select()
			.where(($) => [
				inList($.accountId, ids),
				$.status.eq("open"),
				inList($.provider, invoiceProviders),
			]),
	)
	const paidInvoices = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select()
			.where(($) => [
				inList($.accountId, ids),
				$.status.eq("paid"),
				inList($.provider, invoiceProviders),
				$.subscriptionId.isNotNull(),
				$.paidAt.gte(new Date(now.getTime() - USAGE_WINDOW_DAYS * DAY_MS)),
			]),
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
	const signals = yield* db.run(
		SQLite.from(schema.customerSignalsTable)
			.select()
			.where(($) => [inList($.accountId, ids), $.closedAt.isNull()]),
	)
	// The overdue templates' clocks: open issues only (a closed one has no clock running).
	const issueSlas = yield* db.run(
		SQLite.from(schema.customerIssueSlasTable, "s")
			.innerJoin(schema.customerIssuesTable, "i", (s, i) =>
				SQLite.and(i.id.eq(s.id), i.deletedAt.isNull(), i.closedAt.isNull(), i.status.neq("closed")),
			)
			.select(($) => ({
				accountId: $.accountId,
				issueId: $.id,
				title: $.i.title,
				state: $.state,
				targets: $.targets,
			}))
			.where(($) => [inList($.accountId, ids)]),
	)
	const refs = yield* db.run(
		SQLite.from(schema.customerExternalRefsTable)
			.select("accountId", "provider")
			.where(($) => [inList($.accountId, ids), $.entityType.eq("account")]),
	)
	// The sources holding a record of each account: its refs, and its subscriptions (a source keyed
	// to another's id has no ref of its own).
	const providersBy = new Map<CustomerAccountId, Set<CustomerProvider>>()
	for (const { accountId, provider } of [...refs, ...subscriptions]) {
		const providers = providersBy.get(accountId) ?? new Set<CustomerProvider>()
		providers.add(provider)
		providersBy.set(accountId, providers)
	}

	const billingBy = billingByAccount(
		new Set(base.billingReady),
		subscriptions,
		new Map(accounts.map((account) => [account.id, account.mrrSource])),
	)
	const endedInvoicesBy = yield* endedPlanInvoices(billingBy, ids)
	const churnSignalsBy = groupBy(
		yield* db.run(
			SQLite.from(schema.customerSignalsTable)
				.select("accountId", "firstDetectedAt", "closedAt")
				.where(($) => [inList($.accountId, ids), $.template.eq("churned")]),
		),
		(signal) => signal.accountId,
	)
	const churnNotifiedAt = (id: CustomerAccountId) =>
		latest(
			(churnSignalsBy.get(id) ?? []).map((signal) =>
				signal.closedAt === null ? null : signal.firstDetectedAt,
			),
		)
	// Payments since each account's last churn signal: only those can make a later churn a new one.
	const notified = ids.flatMap((id) => {
		const at = churnNotifiedAt(id)
		return at === null ? [] : [{ id, at }]
	})
	const paymentsBy = groupBy(
		notified.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.customerInvoicesTable)
						.select("accountId", "paidAt")
						.where(($) => [
							inList(
								$.accountId,
								notified.map(({ id }) => id),
							),
							inList($.provider, invoiceProviders),
							$.status.eq("paid"),
							$.amountPaidMinor.gt(0),
							$.paidAt.gt(new Date(Math.min(...notified.map(({ at }) => at.getTime())))),
						]),
				),
		(invoice) => invoice.accountId,
	)
	const invoicesBy = groupBy(openInvoices, (invoice) => invoice.accountId)
	const subscriptionsBy = groupBy(subscriptions, (sub) => sub.accountId)
	const paidInvoicesBy = groupBy(paidInvoices, (invoice) => invoice.accountId)
	const metricsBy = groupBy(metrics, (row) => row.accountId)
	const movementsBy = groupBy(movements, (row) => row.accountId)
	const issueSlasBy = groupBy(issueSlas, (row) => row.accountId)

	const snapshots = accounts.map((stored): Omit<AccountSnapshot, "evaluated"> => {
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
		const unpaidEnd = unpaidEndOf(accountSubs, endedInvoicesBy.get(stored.id) ?? [])
		const rollup = rollupAccount({
			account: stored,
			subscriptions: accountSubs,
			mrrSource: billing?.source ?? null,
			unpaidEnd,
			addOnPlans: base.settings.addOnPlans,
			usageMrr: usageMrrOf(
				subscriptionsBy.get(stored.id) ?? [],
				paidInvoicesBy.get(stored.id) ?? [],
				now,
			),
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
			unpaidSince: unpaidEnd?.since ?? null,
			facts: {
				account,
				stage: rollup.lifecycleStage,
				providers: providersBy.get(stored.id) ?? new Set(),
				contacts: accountContacts,
				activity: byDay,
				lastActiveDay,
				everActiveContacts: own.filter((contact) => contact.firstActiveAt !== null).length,
				priorActive: new Map(
					priorWindows.map((days) => [days, priorActive.get(days)?.get(stored.id) ?? 0]),
				),
				subscriptions: accountSubs,
				openInvoices: invoicesBy.get(stored.id) ?? [],
				unpaidInvoices: unpaidEnd?.open ?? [],
				churnNotifiedAt: churnNotifiedAt(stored.id),
				churnSignalOpen: (churnSignalsBy.get(stored.id) ?? []).some(
					(signal) => signal.closedAt === null,
				),
				paymentsSinceChurn: (paymentsBy.get(stored.id) ?? []).flatMap((invoice) =>
					invoice.paidAt === null ? [] : [invoice.paidAt],
				),
				metrics: metricMap,
				movements: movementsBy.get(stored.id) ?? [],
				openIssueSlas: (issueSlasBy.get(stored.id) ?? []).map(
					({ accountId: _accountId, ...issue }): IssueSlaFacts => issue,
				),
			},
		}
	})
	// The chunk holds whole groups: an environment whose primary is not in it stands alone.
	const loaded = new Set(accounts.map((account) => account.id))
	const primaryOf = (account: schema.CustomerAccount) =>
		account.primaryAccountId !== null && loaded.has(account.primaryAccountId)
			? account.primaryAccountId
			: null
	const environmentsBy = groupBy(
		snapshots.filter((snapshot) => primaryOf(snapshot.stored) !== null),
		(snapshot) => primaryOf(snapshot.stored),
	)
	// `inactive`'s prior windows of a group quiet for longer than the loaded activity: its distinct
	// people (as `groupFacts` counts them: a live contact's email, else the contact) from the store.
	const olderGroupPrior = new Map<CustomerAccountId, Map<number, number>>()
	for (const days of priorWindows) {
		const older: Record<string, { after: Day; last: Day; accounts: ReadonlyArray<CustomerAccountId> }> =
			{}
		for (const [primaryId, environments] of environmentsBy) {
			if (primaryId === null) continue
			const accounts = [primaryId, ...environments.map((environment) => environment.stored.id)]
			const last = accounts
				.map((id) => lastActiveDayBy.get(id) ?? null)
				.reduce<Day | null>(
					(max, day) => (day !== null && (max === null || day > max) ? day : max),
					null,
				)
			if (last !== null && addDays(last, -(days - 1)) < from)
				older[primaryId] = { after: addDays(last, -days), last, accounts }
		}
		if (Object.keys(older).length === 0) continue
		// Per group: its accounts' activity in `(after, last]`, counted as `groupFacts` counts people.
		const rows = yield* db.run(
			SQLite.from(SQLite.jsonEach(older, { key: accountIdText }), "g")
				.crossJoin(
					($) =>
						SQLite.jsonEach(SQLite.jsonExtract($.value, "$.accounts", SQLite.text), {
							value: accountIdText,
						}),
					"m",
				)
				.innerJoin(schema.customerActivityDailyTable, "a", (g, a) =>
					a.accountId
						.eq(g.m.value)
						.and(a.day.gt(SQLite.jsonExtract(g.value, "$.after", SQLite.text)))
						.and(a.day.lte(SQLite.jsonExtract(g.value, "$.last", SQLite.text))),
				)
				.leftJoin(schema.customerContactsTable, "c", (g, c) => c.id.eq(g.a.contactId))
				.select(($) => ({
					primaryId: $.key,
					count: SQLite.countDistinct(
						SQLite.caseWhen(
							[
								[
									$.c.deletedAt
										.isNull()
										.and(SQLite.trim(SQLite.coalesce($.c.email, "")).neq("")),
									SQLite.lower(SQLite.trim($.c.email)),
								],
							],
							$.a.contactId,
						),
					),
				}))
				.where(($) => [isActive($.a)])
				.groupBy("primaryId"),
		)
		for (const row of rows) {
			const counts = olderGroupPrior.get(row.primaryId) ?? new Map<number, number>()
			counts.set(days, Number(row.count))
			olderGroupPrior.set(row.primaryId, counts)
		}
	}
	const withEvaluated = snapshots.map((snapshot): AccountSnapshot => {
		const environments = environmentsBy.get(snapshot.stored.id)
		return {
			...snapshot,
			evaluated:
				primaryOf(snapshot.stored) !== null
					? null
					: environments === undefined
						? snapshot.facts
						: groupFacts(
								snapshot.facts,
								environments.map((environment) => environment.facts),
								from,
								olderGroupPrior.get(snapshot.stored.id),
							),
		}
	})
	yield* Effect.annotateCurrentSpan({ "customers.groups": environmentsBy.size })
	return {
		...base,
		accounts: withEvaluated,
		signals,
	} satisfies Snapshot
})
