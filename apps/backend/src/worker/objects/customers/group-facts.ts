/**
 * A customer with several environments (`./groups.ts`) is alerted on as one: signals evaluate its
 * primary over the group's combined facts (pure), so "logins stopped" does not fire for one
 * environment while another still has logins. Each account's own facts keep feeding its rollups and
 * health.
 *
 * - Contacts and activity: unioned, a person in several environments counted once (the same email,
 *   case-insensitive, else the same contact); the last active day, ever-active contacts and the
 *   `inactive` prior windows are recomputed over the union (`loadAccounts` counts the windows older
 *   than the loaded activity the same way).
 * - Billing: subscriptions and open invoices together; MRR movements become the group's total MRR
 *   on each day one of them moved.
 * - Metrics: values (and limits) summed per day.
 * - Health: the primary's.
 * - The account: the primary's row with MRR, trial list price and seats summed, the earliest first
 *   seen, customer since and trial end, the latest activity, the tags of all, and the most advanced
 *   stage (churned only when every environment is).
 */
import type { schema } from "@hazel/db"
import type { Day, LifecycleStage } from "@hazel/domain/customers"
import type { CustomerContactId } from "@hazel/schema"
import type { AccountFacts, ContactFacts, MetricPoint } from "./facts"
import { addDays } from "./time"

const STAGE_RANK = { churned: 0, lead: 1, trialing: 2, past_due: 3, active: 4 } satisfies Record<
	LifecycleStage,
	number
>

/** A customer's stage: the most advanced of its environments' (one paying makes it active). */
export const groupStage = (stages: readonly [LifecycleStage, ...Array<LifecycleStage>]): LifecycleStage =>
	stages.reduce((best, stage) => (STAGE_RANK[stage] > STAGE_RANK[best] ? stage : best))

/** A customer's plan: its primary's, else the first environment's that has one. */
export const groupPlanName = (
	primary: { readonly planName: string | null },
	accounts: ReadonlyArray<{ readonly planName: string | null }>,
): string | null =>
	primary.planName ?? accounts.find((account) => account.planName !== null)?.planName ?? null

const earliest = <A extends Date | Day>(values: ReadonlyArray<A | null>): A | null =>
	values.reduce<A | null>(
		(min, value) => (value !== null && (min === null || value < min) ? value : min),
		null,
	)

export const latest = <A extends Date | Day>(values: ReadonlyArray<A | null>): A | null =>
	values.reduce<A | null>(
		(max, value) => (value !== null && (max === null || value > max) ? value : max),
		null,
	)

/** Null when every value is. */
export const sumOrNull = (values: ReadonlyArray<number | null>) =>
	values.every((value) => value === null)
		? null
		: values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

/** One person across the environments: the same email, else the same contact. */
const personKey = (contact: ContactFacts) => contact.email?.trim().toLowerCase() || contact.id

/**
 * The group's MRR movements: on each day any environment's MRR moved, the group's total before and
 * after (an environment's MRR before its first movement is that movement's `from`, without any its
 * current MRR). A day the moves cancel out leaves none.
 */
export const groupMovements = (
	group: ReadonlyArray<AccountFacts>,
): ReadonlyArray<schema.CustomerMrrMovement> => {
	const current = group.map((facts) => facts.movements[0]?.fromMrrMinor ?? facts.account.mrrMinor)
	const byDay = new Map<Day, Array<{ index: number; movement: schema.CustomerMrrMovement }>>()
	group.forEach((facts, index) => {
		for (const movement of facts.movements)
			byDay.set(movement.day, [...(byDay.get(movement.day) ?? []), { index, movement }])
	})
	const total = () => current.reduce((sum, value) => sum + value, 0)
	return [...byDay.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.flatMap(([day, moves]) => {
			const from = total()
			for (const { index, movement } of moves) current[index] = movement.toMrrMinor
			const to = total()
			if (from === to) return []
			const first = moves[0].movement
			return [
				{
					...first,
					accountId: group[0].account.id,
					day,
					type:
						from === 0
							? first.type
							: to === 0
								? "churn"
								: to > from
									? "expansion"
									: "contraction",
					deltaMinor: to - from,
					fromMrrMinor: from,
					toMrrMinor: to,
				} satisfies schema.CustomerMrrMovement,
			]
		})
}

/**
 * The facts signals evaluate for a primary with environments. `from` is the first day of activity
 * loaded: a prior window starting before it (a group quiet for longer) is not in the union, and its
 * count comes from `olderPriorActive` (window → distinct people, read by `loadAccounts`).
 */
export const groupFacts = (
	primary: AccountFacts,
	environments: ReadonlyArray<AccountFacts>,
	from: Day,
	olderPriorActive: ReadonlyMap<number, number> = new Map(),
): AccountFacts => {
	const group = [primary, ...environments]

	const people = new Map<string, ContactFacts>()
	const personOf = new Map<CustomerContactId, CustomerContactId>()
	for (const contact of group.flatMap((facts) => facts.contacts)) {
		const key = personKey(contact)
		const held = people.get(key)
		personOf.set(contact.id, held?.id ?? contact.id)
		people.set(
			key,
			held === undefined
				? contact
				: {
						id: held.id,
						name: held.name ?? contact.name,
						email: held.email ?? contact.email,
						role: held.role ?? contact.role,
						firstActiveAt: earliest([held.firstActiveAt, contact.firstActiveAt]),
						lastActiveDay: latest([held.lastActiveDay, contact.lastActiveDay]),
					},
		)
	}
	const contacts = [...people.values()]

	const activity = new Map<Day, Map<CustomerContactId, number>>()
	for (const facts of group) {
		for (const [day, active] of facts.activity) {
			const into = activity.get(day) ?? new Map<CustomerContactId, number>()
			for (const [contactId, events] of active) {
				const person = personOf.get(contactId) ?? contactId
				into.set(person, (into.get(person) ?? 0) + events)
			}
			activity.set(day, into)
		}
	}
	const lastActiveDay = latest(group.map((facts) => facts.lastActiveDay))
	const priorActive = new Map(
		[...primary.priorActive.keys()].map((days) => {
			if (lastActiveDay === null) return [days, 0]
			const start = addDays(lastActiveDay, -(days - 1))
			if (start < from) return [days, olderPriorActive.get(days) ?? 0]
			const users = new Set<CustomerContactId>()
			for (const [day, active] of activity) {
				if (day >= start && day <= lastActiveDay)
					for (const person of active.keys()) users.add(person)
			}
			return [days, users.size]
		}),
	)

	const metrics = new Map<string, Map<Day, MetricPoint>>()
	for (const [key, points] of group.flatMap((facts) => [...facts.metrics])) {
		const days = metrics.get(key) ?? new Map<Day, MetricPoint>()
		for (const point of points) {
			const held = days.get(point.day)
			days.set(
				point.day,
				held === undefined
					? point
					: {
							day: point.day,
							value: held.value + point.value,
							limitValue: sumOrNull([held.limitValue, point.limitValue]),
						},
			)
		}
		metrics.set(key, days)
	}

	const stage = groupStage([primary.stage, ...environments.map((facts) => facts.stage)])
	const accounts = group.map((facts) => facts.account)
	return {
		account: {
			...primary.account,
			lifecycleStage: stage,
			mrrMinor: accounts.reduce((sum, account) => sum + account.mrrMinor, 0),
			trialListMrrMinor: sumOrNull(accounts.map((account) => account.trialListMrrMinor)),
			trialEndsAt: earliest(accounts.map((account) => account.trialEndsAt)),
			planName: groupPlanName(primary.account, accounts),
			seatsUsed: sumOrNull(accounts.map((account) => account.seatsUsed)),
			seatsLimit: sumOrNull(accounts.map((account) => account.seatsLimit)),
			contactCount: contacts.length,
			firstSeenAt:
				earliest(accounts.map((account) => account.firstSeenAt)) ?? primary.account.firstSeenAt,
			customerSince: earliest(accounts.map((account) => account.customerSince)),
			churnedAt: latest(accounts.map((account) => account.churnedAt)),
			lastActiveAt: latest(accounts.map((account) => account.lastActiveAt)),
			tags: [...new Set(accounts.flatMap((account) => account.tags))],
		},
		stage,
		providers: new Set(group.flatMap((facts) => [...facts.providers])),
		contacts,
		activity,
		lastActiveDay,
		everActiveContacts: contacts.filter((contact) => contact.firstActiveAt !== null).length,
		priorActive,
		subscriptions: group.flatMap((facts) => facts.subscriptions),
		openInvoices: group.flatMap((facts) => facts.openInvoices),
		metrics: new Map(
			[...metrics].map(([key, days]) => [
				key,
				[...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
			]),
		),
		movements: groupMovements(group),
		health: primary.health,
	}
}
