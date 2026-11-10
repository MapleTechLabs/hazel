/**
 * What compute knows about the org and each account at one instant: the input of signal
 * evaluation (`./evaluate.ts`), the health score and the dry runs, loaded by `./snapshot.ts`. Plain
 * data, so the pure parts are tested with hand-built facts.
 */
import type { schema } from "@hazel/db"
import type {
	CustomerProvider,
	Day,
	HealthStatus,
	LifecycleStage,
	SeriesPoint,
} from "@hazel/domain/customers"
import type { CustomerContactId } from "@hazel/schema"
import { addDays, dayRange } from "./time"

export interface ContactFacts {
	readonly id: CustomerContactId
	readonly name: string | null
	readonly email: string | null
	readonly role: string | null
	readonly firstActiveAt: Date | null
	/** All time. */
	readonly lastActiveDay: Day | null
}

export interface MetricPoint {
	readonly day: Day
	readonly value: number
	readonly limitValue: number | null
}

export interface HealthPoint {
	readonly day: Day
	readonly score: number | null
	readonly status: HealthStatus
}

export interface AccountFacts {
	readonly account: schema.CustomerAccount
	/** Effective: the override, else derived. */
	readonly stage: LifecycleStage
	/** Live contacts. */
	readonly contacts: ReadonlyArray<ContactFacts>
	/** Active contacts per day, with their event counts, over the loaded window. */
	readonly activity: ReadonlyMap<Day, ReadonlyMap<CustomerContactId, number>>
	/** The last day any contact was active (all time). */
	readonly lastActiveDay: Day | null
	/** Contacts ever active. */
	readonly everActiveContacts: number
	/** Window (days) → distinct users active in the window ending on `lastActiveDay`. */
	readonly priorActive: ReadonlyMap<number, number>
	/** The billing source's subscriptions (Autumn when connected, else Stripe). */
	readonly subscriptions: ReadonlyArray<schema.CustomerSubscription>
	readonly openInvoices: ReadonlyArray<schema.CustomerInvoice>
	/** Source metrics over the loaded window, oldest first. */
	readonly metrics: ReadonlyMap<string, ReadonlyArray<MetricPoint>>
	/** MRR movements, oldest first. */
	readonly movements: ReadonlyArray<schema.CustomerMrrMovement>
	/** Daily health over the loaded window, oldest first (today's once scored). */
	readonly health: ReadonlyArray<HealthPoint>
}

export interface OrgFacts {
	readonly now: Date
	readonly today: Day
	/** Providers with a connection that is not disconnected. */
	readonly connected: ReadonlySet<CustomerProvider>
	readonly metricNames: ReadonlyMap<string, string>
	readonly currency: string
}

/** Distinct contacts active on any day of `[from, to]`. */
export const activeUsersIn = (facts: AccountFacts, from: Day, to: Day): number => {
	const users = new Set<CustomerContactId>()
	for (const [day, contacts] of facts.activity) {
		if (day >= from && day <= to) for (const contact of contacts.keys()) users.add(contact)
	}
	return users.size
}

/** Daily active users for `count` days ending `last`. */
export const dauSeries = (facts: AccountFacts, last: Day, count: number): Array<SeriesPoint> =>
	dayRange(last, count).map((day) => ({ day, value: facts.activity.get(day)?.size ?? 0 }))

/** Distinct users active in the 30 days up to each of `count` days ending `last`. */
export const rollingActiveSeries = (facts: AccountFacts, last: Day, count: number): Array<SeriesPoint> =>
	dayRange(last, count).map((day) => ({ day, value: activeUsersIn(facts, addDays(day, -29), day) }))

/** The account's MRR on each day, carried forward from its movements. */
export const mrrSeries = (
	movements: ReadonlyArray<schema.CustomerMrrMovement>,
	current: number,
	last: Day,
	count: number,
): Array<SeriesPoint> => {
	const sorted = [...movements].sort((a, b) => (a.day < b.day ? -1 : 1))
	return dayRange(last, count).map((day) => {
		let value = sorted.length === 0 ? current : sorted[0].fromMrrMinor
		for (const movement of sorted) {
			if (movement.day > day) break
			value = movement.toMrrMinor
		}
		return { day, value }
	})
}

/** A source metric's daily values (0 where missing). */
export const metricSeries = (
	facts: AccountFacts,
	key: string,
	last: Day,
	count: number,
): Array<SeriesPoint> => {
	const points = new Map((facts.metrics.get(key) ?? []).map((point) => [point.day, point.value]))
	return dayRange(last, count).map((day) => ({ day, value: points.get(day) ?? 0 }))
}

/** Any built-in or source metric's series. */
export const seriesOf = (facts: AccountFacts, key: string, last: Day, count: number): Array<SeriesPoint> => {
	switch (key) {
		case "active_users":
			return dauSeries(facts, last, count)
		case "active_users_30d":
			return rollingActiveSeries(facts, last, count)
		case "mrr":
			return mrrSeries(facts.movements, facts.account.mrrMinor, last, count)
		case "health_score": {
			const scores = new Map(facts.health.map((point) => [point.day, point.score ?? 0]))
			return dayRange(last, count).map((day) => ({ day, value: scores.get(day) ?? 0 }))
		}
		default:
			return metricSeries(facts, key, last, count)
	}
}

export const formatMoney = (minor: number, currency: string) => {
	try {
		return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
			minor / 100,
		)
	} catch {
		return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
	}
}
