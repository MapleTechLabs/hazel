/**
 * Autumn records → `IngestOp`s (`docs/customers/tech-design.md` §3). Pure: webhooks and pulls both
 * come through here, so one mapping is tested once.
 *
 * The shape of the mapping:
 *
 * - **Customer → account.** Autumn is a billing source, not an identity one: a customer never
 *   creates a customer record on its own (`onNoMatch: "unmatched"`). It lands on an account through
 *   the **shared id** — Autumn's customer id *is* the Clerk organization id wherever the app keyed
 *   it that way (`AutumnConnectionConfig.customerIdIsClerkOrgId`, on by default) — or, failing
 *   that, through the domain of the customer's email. Everything else waits in the unmatched list
 *   for a human to link, and ingest replays it then.
 * - **License seats → `seatsUsed` / `seatsLimit`.** Autumn outranks Clerk's member count for these
 *   (`FIELD_PRECEDENCE`): a plan's seat pool is what the customer pays for.
 * - **Recurring plan → subscription**, keyed `<customer id>:<subscription id>`, with MRR (base
 *   price plus prepaid units) normalized to a monthly amount in the currency's minor units
 *   ({@link subscriptionMrr}). Autumn quotes amounts in *major* units of the organization's default
 *   currency, so the amount is scaled by that currency's minor-unit factor.
 * - **Feature balance → metric.** One metric per feature (`autumn.<feature_id>`, namespaced because
 *   ingest refuses a key another provider owns), its value the period's usage and its `limitValue`
 *   the granted amount — which is what the `near_limit` signal reads.
 * - **Timeline events.** Subscription lifecycle entries are ingest's (it raises
 *   `subscription.started` / `plan_changed` / `canceled` / `cancel_scheduled` from the state these
 *   ops describe), so the adapter raises only what ingest cannot see: a feature limit reached
 *   (`usage.limit_reached`) and a usage alert crossed (`usage.limit_approaching`).
 * - **Ordering.** Every op carries `observedAt`, the time Hazel read the record (taken before the
 *   request; Autumn's records have no `updated_at` of their own), so a late delivery cannot revive
 *   a customer deleted since, and a slow read of a subscription cannot overwrite a newer one.
 * - **Not mapped.** Invoices (Stripe owns them, `tech-design.md` §4.2), one-off purchases (no
 *   recurring amount), entity-scoped plans and balances (a sub-customer's, not the account's), and
 *   `scheduled` plans (not billing yet, and Hazel's model has no scheduled status; a scheduled paid
 *   base plan only marks the current one's cancellation as a downgrade).
 */
import type {
	ConnectionConfig,
	DefineMetric,
	IngestOp,
	IsoTimestamp,
	ProviderRef,
	RecordEvent,
	RecordMetric,
	SubscriptionStatus,
	UpsertAccount,
	UpsertSubscription,
} from "@hazel/domain/customers"
import type { Types } from "effect"
import { dayOf } from "../time"
import {
	type AutumnBalance,
	type AutumnBalanceEvent,
	type AutumnCustomer,
	type AutumnEnv,
	type AutumnLicense,
	type AutumnPlan,
	type AutumnSubscription,
	customerUrlOf,
	isoOf,
	minorUnitsOf,
	monthlyFactorOf,
} from "./wire"

export const autumnRef = (externalId: string): ProviderRef => ({ provider: "autumn", externalId })

const clerkRef = (externalId: string): ProviderRef => ({ provider: "clerk", externalId })

/** The prefix every Autumn metric key carries: two providers never share a key (ingest refuses it). */
export const METRIC_PREFIX = "autumn."

export const metricKeyOf = (featureId: string): string => `${METRIC_PREFIX}${featureId}`

/** Whether this connection takes the Autumn customer id for the Clerk organization id. */
export const idIsClerkOrgId = (config: ConnectionConfig): boolean =>
	config._tag !== "autumn" || config.customerIdIsClerkOrgId

const emailDomainOf = (email: string | null | undefined): string | null => {
	if (email == null) return null
	const at = email.lastIndexOf("@")
	const domain =
		at === -1
			? ""
			: email
					.slice(at + 1)
					.trim()
					.toLowerCase()
	// Ingest normalizes and drops free-mail domains; this only needs to be a domain at all.
	return domain.includes(".") ? domain : null
}

/** The seats a customer's license pools grant and use; null when Autumn grants none. */
const seatsOf = (
	licenses: ReadonlyArray<AutumnLicense> | null | undefined,
): { readonly used: number; readonly limit: number } | null => {
	const pools = (licenses ?? []).filter((pool) => pool.granted != null || pool.usage != null)
	if (pools.length === 0) return null
	const total = (pick: (pool: AutumnLicense) => number | null | undefined) =>
		pools.reduce((sum, pool) => sum + Math.max(0, Math.round(pick(pool) ?? 0)), 0)
	return { used: total((pool) => pool.usage), limit: total((pool) => pool.granted) }
}

/**
 * A customer. `observedAt` orders it against a deletion. The email's domain is a match key, not a
 * fact about the account (a billing email is often an accountant's own): it is sent only when the
 * customer id is not a shared id, so a customer placed by its Clerk organization id never teaches
 * the account a domain. One matched by domain already has it.
 */
export const accountOp = (
	customer: AutumnCustomer & { readonly id: string },
	config: ConnectionConfig,
	env: AutumnEnv,
	observedAt?: IsoTimestamp,
): UpsertAccount => {
	const sharedId = idIsClerkOrgId(config)
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: customer.id,
		externalUrl: customerUrlOf(customer.id, env),
		sameAs: sharedId ? [clerkRef(customer.id)] : [],
		// Billing sources never invent a customer: an unmatched one waits for a human.
		onNoMatch: "unmatched",
	}
	// Absent must not clear what another source established.
	if (customer.name != null && customer.name.trim() !== "") op.name = customer.name.trim()
	const domain = sharedId ? null : emailDomainOf(customer.email)
	if (domain !== null) {
		op.domains = [domain]
		op.matchByDomain = true
	}
	const seats = seatsOf(customer.licenses)
	if (seats !== null) {
		op.seatsUsed = seats.used
		op.seatsLimit = seats.limit
	}
	const createdAt = isoOf(customer.created_at)
	if (createdAt !== null) op.createdAt = createdAt
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Autumn's plan states onto Hazel's. A plan is `active` with `past_due` beside it, `scheduled`
 * before it starts, or `expired` once it ends; a trial is an `active` plan with `trial_ends_at`
 * still set (Autumn clears it when the trial converts).
 *
 * `scheduled` is skipped: it bills nothing yet, Hazel's model has no scheduled status, and
 * recording it as active would count a future plan's amount as MRR today.
 */
export const statusOf = (subscription: AutumnSubscription): SubscriptionStatus | null => {
	if (subscription.status === "expired") return "canceled"
	if (subscription.status === "scheduled") return null
	if (subscription.past_due === true) return "past_due"
	return subscription.trial_ends_at != null ? "trialing" : "active"
}

/** A plan a sub-customer holds, not the account: Autumn scopes those to an entity. */
export const isEntityScoped = (subscription: AutumnSubscription): boolean =>
	subscription.scope === "entity" || (subscription.entity_id != null && subscription.entity_id !== "")

/** `month` and `year` as they are; a quarterly, weekly, one-off or unknown cadence is `other`. */
export const billingIntervalOf = (plan: AutumnPlan | undefined): UpsertSubscription["interval"] => {
	const interval = plan?.price?.interval ?? null
	return interval === "month" || interval === "year" ? interval : "other"
}

/** What prices a plan: each plan's active version, and the currency Autumn quotes amounts in. */
export interface Pricing {
	readonly plans: ReadonlyMap<string, AutumnPlan>
	readonly currency: string
}

const quantityOf = (subscription: AutumnSubscription) => Math.max(1, Math.round(subscription.quantity ?? 1))

/**
 * The monthly amount, in major units, of the units a customer bought on top of a plan's included
 * ones (a `prepaid` item: seats, credit packs). Autumn reports them on the customer's balances, not
 * on the subscription: each grant names its plan, the units bought (`prepaid_grant`) and the price
 * per `billing_units` of them; the plan's item says how often that price is billed. A tiered price
 * (no flat `amount`) counts as nothing. A grant names no subscription, so the plan's grants are
 * split evenly over the customer's live subscriptions to it (`holders`): their sum is right, each
 * one's share an estimate.
 */
const prepaidMonthly = (
	planId: string,
	plan: AutumnPlan | undefined,
	balances: ReadonlyArray<AutumnBalance>,
	holders: number,
): number =>
	balances.reduce((total, balance) => {
		const item = plan?.items?.find((entry) => entry.feature_id === balance.feature_id)
		const factor = item?.price == null ? null : monthlyFactorOf(item.price)
		if (factor === null) return total
		return (balance.breakdown ?? []).reduce((sum, grant) => {
			const price = grant.price ?? null
			const bought = grant.prepaid_grant ?? 0
			const units = price?.billing_units != null && price.billing_units > 0 ? price.billing_units : 1
			const counts =
				grant.plan_id === planId &&
				grant.source !== "entity" &&
				price?.billing_method === "prepaid" &&
				price.amount != null &&
				bought > 0
			return counts ? sum + ((bought / units) * (price.amount ?? 0) * factor) / holders : sum
		}, total)
	}, 0)

/**
 * A subscription's MRR in minor units: the plan's base price × the quantity, plus the prepaid units
 * bought on top of it ({@link prepaidMonthly}), each normalized to a month and converted from
 * Autumn's major units to the currency's minor ones. Rounded once, at the end, and never below zero.
 *
 * What is *not* in it: a `usage_based` item, billed after the period for what was used and not
 * knowable in advance (Stripe's metered prices are left out the same way). A plan billed only that
 * way, or a free one, is MRR 0; the former is marked `billsByUsage` ({@link subscriptionOps}).
 */
export const subscriptionMrr = (
	subscription: AutumnSubscription,
	plan: AutumnPlan | undefined,
	currency: string,
	balances: ReadonlyArray<AutumnBalance> = [],
	holders = 1,
): number => {
	const price = plan?.price ?? null
	const factor = price === null ? null : monthlyFactorOf(price)
	const base =
		price?.amount == null || factor === null ? 0 : price.amount * factor * quantityOf(subscription)
	const monthly = base + prepaidMonthly(subscription.plan_id, plan, balances, holders)
	return Math.max(0, Math.round(monthly * minorUnitsOf(currency)))
}

/**
 * Whether a plan bills what MRR leaves out ({@link subscriptionMrr}): a `usage_based` item (billed
 * after the period), or prepaid units the customer bought at a tiered price (no flat `amount`).
 */
const billsOutsideMrr = (
	planId: string,
	plan: AutumnPlan | undefined,
	balances: ReadonlyArray<AutumnBalance>,
): boolean =>
	(plan?.items ?? []).some((item) => item.price?.billing_method === "usage_based") ||
	balances.some((balance) =>
		(balance.breakdown ?? []).some(
			(grant) =>
				grant.plan_id === planId &&
				grant.source !== "entity" &&
				grant.price?.billing_method === "prepaid" &&
				grant.price.amount == null &&
				(grant.prepaid_grant ?? 0) > 0,
		),
	)

/**
 * A subscription's external id. Autumn's `id` is unique among one customer's live plans only (the
 * app's own `subscription_id`), so the customer id keys it.
 */
const subscriptionIdOf = (customerId: string, id: string): string => `${customerId}:${id}`

/**
 * Whether a plan bills prepaid units (seats, credit packs) every period, at any price, flat or
 * tiered. A one-off pack (`one_off` interval) is no recurring revenue.
 */
const sellsPrepaid = (plan: AutumnPlan | undefined): boolean =>
	(plan?.items ?? []).some(
		(item) =>
			item.price != null &&
			item.price.billing_method === "prepaid" &&
			monthlyFactorOf(item.price) !== null,
	)

/** A customer's holdings of one plan: their prepaid units are one pool in the balances. */
const poolOf = (customerId: string | null, planId: string): string => JSON.stringify([customerId, planId])

/** The ten minutes Autumn adds to a trial's end (`freeTrialToStripeTimestamp`), and an hour's slack. */
const TRIAL_END_SLACK_MS = 70 * 60_000

/** `at` plus `months` calendar months in UTC, a day past the target month's end clamped to it. */
const addMonths = (at: number, months: number): number => {
	const date = new Date(at)
	const day = date.getUTCDate()
	date.setUTCDate(1)
	date.setUTCMonth(date.getUTCMonth() + months)
	const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
	date.setUTCDate(Math.min(day, lastDay))
	return date.getTime()
}

/**
 * When a plan's trial ended: Autumn reports `trial_ends_at` only while the trial runs, so it
 * comes from the plan's trial terms and the plan's start, by calendar (UTC days, months, years),
 * plus the ten minutes Autumn adds and an hour's slack. Null without a trial or a start. A plan
 * whose trial is as long as its billing interval cannot be told apart from Autumn's API: one never
 * given the trial (already used) and canceled after its first paid period ends at the same time.
 */
const trialEndOf = (subscription: AutumnSubscription, plan: AutumnPlan | undefined): number | null => {
	const length = plan?.free_trial?.duration_length
	const start = subscription.started_at
	if (length == null || start == null) return null
	switch (plan?.free_trial?.duration_type ?? "day") {
		case "day":
			return start + length * 86_400_000 + TRIAL_END_SLACK_MS
		case "month":
			return addMonths(start, length) + TRIAL_END_SLACK_MS
		case "year":
			return addMonths(start, length * 12) + TRIAL_END_SLACK_MS
		default:
			return null
	}
}

/**
 * A batch of plans, read at `observedAt` (ingest drops a read older than one it applied). Skipped:
 * an entity-scoped plan, a `scheduled` one, and a row whose customer Autumn did not name.
 *
 * - **Prices**: the customer's own version of the plan when the read expanded it (custom prices,
 *   grandfathered versions), else the plan's active version; `balances` add the customer's prepaid
 *   units to its live plans (the customer's own balances: pass them only for a batch of one
 *   customer's plans; an ended plan's grants are gone from them).
 * - **Downgrades**: a paid base plan Autumn has scheduled in the current one's group replaces it at
 *   its period end, and Autumn marks the current one canceled. It is a plan change, not a
 *   cancellation, so the current plan keeps `cancelAtPeriodEnd` false. The free plan Autumn
 *   schedules on a cancel (its group's `auto_enable` one) is no downgrade: the plan is canceling.
 * - **Never billed**: a plan no processor ever billed (no billing period: a trial that lapsed
 *   unconverted, ended or still live until Autumn converts it), or one that ended within its trial
 *   ({@link trialEndOf}, sent as `trialEndsAt`: a card trial canceled before it converted has a
 *   billing period, the trial's), is MRR 0, so its account reads as a lead rather than a paying or
 *   churned customer. A customer Autumn gave no trial (one already used) that ends within the
 *   trial's length reads so too.
 * - **Converted trials**: Autumn clears a converted trial's `trial_ends_at`; a live plan whose
 *   billing period starts at or after the trial's end ({@link trialEndOf}) sends that end as
 *   `trialEndsAt`, so the account's `customerSince` and MRR history leave the trial days out. A
 *   customer given no trial (one already used) reads so too once its plan renewed.
 * - **Billed by usage**: a plan at MRR 0 that still bills ({@link billsOutsideMrr}) sets
 *   `billsByUsage`, so core counts its account as paying (or, once it ended, as churned).
 * - **Unpriced**: Autumn's balances carry only active plans' grants unless the org counts past_due
 *   ones too (`include_past_due`). A plan selling prepaid units held `past_due` with no grant there,
 *   or held twice (a grant names no holding, so the pool may lack the past_due one's), cannot be
 *   priced: every live holding of it sends no `mrrMinor` (nor `listMrrMinor`, `billsByUsage`), and
 *   ingest keeps the stored MRR.
 * - **One id twice** (an ended plan whose `subscription_id` a live one reuses): the live one wins.
 */
export const subscriptionOps = (
	subscriptions: ReadonlyArray<AutumnSubscription>,
	options: {
		readonly customerId?: string
		readonly pricing: Pricing
		readonly balances?: ReadonlyArray<AutumnBalance>
		readonly observedAt: IsoTimestamp
	},
): Array<UpsertSubscription> => {
	const { currency } = options.pricing
	const customerOf = (subscription: AutumnSubscription) =>
		subscription.customer_id ?? options.customerId ?? null
	const planOf = (subscription: AutumnSubscription) =>
		subscription.plan ?? options.pricing.plans.get(subscription.plan_id)
	/** A customer's base plans in one group: one replaces another. */
	const slotOf = (customerId: string | null, plan: AutumnPlan | undefined) =>
		JSON.stringify([customerId, plan?.group ?? null])
	const base = (subscription: AutumnSubscription) =>
		subscription.add_on !== true && !isEntityScoped(subscription)
	const downgrading = new Set(
		subscriptions.flatMap((subscription) => {
			const plan = planOf(subscription)
			// Prepaid units are priced from balances a scheduled plan has none of yet.
			const paid =
				subscriptionMrr(subscription, plan, currency) > 0 ||
				billsOutsideMrr(subscription.plan_id, plan, []) ||
				sellsPrepaid(plan)
			return subscription.status === "scheduled" &&
				base(subscription) &&
				(subscription.auto_enable ?? plan?.auto_enable) !== true &&
				paid
				? [slotOf(customerOf(subscription), plan)]
				: []
		}),
	)
	const holders = new Map<string, number>()
	for (const subscription of subscriptions) {
		const status = statusOf(subscription)
		if (status === null || status === "canceled" || isEntityScoped(subscription)) continue
		const key = poolOf(customerOf(subscription), subscription.plan_id)
		holders.set(key, (holders.get(key) ?? 0) + 1)
	}
	/** The customer's own grants of the plan: a sub-customer's (`source: "entity"`) are not its. */
	const granted = (planId: string) =>
		(options.balances ?? []).some((balance) =>
			(balance.breakdown ?? []).some((grant) => grant.plan_id === planId && grant.source !== "entity"),
		)
	const unpriced = new Set(
		subscriptions.flatMap((subscription) => {
			const key = poolOf(customerOf(subscription), subscription.plan_id)
			return statusOf(subscription) === "past_due" &&
				!isEntityScoped(subscription) &&
				sellsPrepaid(planOf(subscription)) &&
				((holders.get(key) ?? 1) > 1 || !granted(subscription.plan_id))
				? [key]
				: []
		}),
	)
	const byId = new Map<string, UpsertSubscription>()
	for (const subscription of subscriptions) {
		const customerId = customerOf(subscription)
		const status = statusOf(subscription)
		if (customerId === null || status === null || isEntityScoped(subscription)) continue
		const plan = planOf(subscription)
		const expired = status === "canceled"
		const trialEnd = subscription.trial_ends_at == null ? trialEndOf(subscription, plan) : null
		const endedAt = subscription.expires_at ?? subscription.canceled_at
		const endedInTrial = expired && trialEnd !== null && endedAt != null && endedAt <= trialEnd
		// Live and billed for a period from its trial's end on: the trial converted (Autumn cleared
		// `trial_ends_at`). The first paid period's start is the exact end, a later one's the terms'.
		const periodStart = subscription.current_period_start
		const convertedAt =
			!expired &&
			trialEnd !== null &&
			periodStart != null &&
			periodStart >= trialEnd - TRIAL_END_SLACK_MS
				? Math.min(trialEnd, periodStart)
				: null
		// No billing period: ended that way, or live past a trial no processor took over (Autumn's
		// card-less trial awaiting conversion). A live plan without a trial may be billed outside
		// Stripe (`no_billing_changes`), so it keeps its price. The period is Autumn's mirror of the
		// processor's subscription (its `subscriptions` row, `getApiSubscription`): a billed plan whose
		// mirror row is missing reads as never billed too.
		const neverBilled =
			endedInTrial ||
			(subscription.current_period_end == null &&
				(expired || (status === "active" && plan?.free_trial != null)))
		const balances = expired ? [] : (options.balances ?? [])
		const mrrMinor = neverBilled
			? 0
			: subscriptionMrr(
					subscription,
					plan,
					currency,
					balances,
					holders.get(poolOf(customerId, subscription.plan_id)) ?? 1,
				)
		const canceling =
			!expired &&
			subscription.canceled_at != null &&
			!(base(subscription) && downgrading.has(slotOf(customerId, plan)))
		const op: Types.Mutable<UpsertSubscription> = {
			_tag: "subscription",
			externalId: subscriptionIdOf(customerId, subscription.id),
			account: autumnRef(customerId),
			planName: plan?.name ?? subscription.plan_id,
			status,
			currency,
			interval: billingIntervalOf(plan),
			quantity: quantityOf(subscription),
			startedAt: isoOf(subscription.started_at),
			trialEndsAt: isoOf(endedInTrial ? trialEnd : (convertedAt ?? subscription.trial_ends_at)),
			currentPeriodEnd: isoOf(subscription.current_period_end ?? subscription.expires_at),
			// A cancellation Autumn has recorded but not yet carried out: the plan runs to `expires_at`.
			cancelAtPeriodEnd: canceling,
			canceledAt: expired
				? isoOf(subscription.canceled_at ?? subscription.expires_at)
				: canceling
					? isoOf(subscription.canceled_at)
					: null,
			observedAt: options.observedAt,
		}
		// Unpriced, the op leaves the stored MRR as it is.
		if (expired || !unpriced.has(poolOf(customerId, subscription.plan_id))) {
			op.mrrMinor = mrrMinor
			// The customer's own plan carries any custom price, so the list price is the price.
			op.listMrrMinor = mrrMinor
			op.billsByUsage =
				!neverBilled && mrrMinor === 0 && billsOutsideMrr(subscription.plan_id, plan, balances)
		}
		const held = byId.get(op.externalId)
		if (held === undefined || (held.status === "canceled" && !expired)) byId.set(op.externalId, op)
	}
	return [...byId.values()]
}

// ---------------------------------------------------------------------------
// Balances → metrics
// ---------------------------------------------------------------------------

/**
 * The feature's own name, when this read carries one (both customer reads expand it). Without one
 * the definition is left to the walk's feature phase (or, for a feature added since, to ingest,
 * which names it after the key until that phase runs again). A definition is never written from a
 * name Hazel had to guess: it would overwrite the real one.
 */
const nameOf = (balance: AutumnBalance, names: ReadonlyMap<string, string>): string | null => {
	const name = balance.feature?.name?.trim() ?? names.get(balance.feature_id)?.trim() ?? ""
	return name === "" ? null : name
}

const definitionOf = (key: string, name: string): DefineMetric => ({
	_tag: "metric_definition",
	key,
	name,
	unit: null,
	// A balance is the period's level, not a daily increment: a span of days takes the highest.
	aggregation: "max",
	description: null,
})

/**
 * The plan limit a `near_limit` signal measures against: the granted units, unless the feature is
 * unlimited or the plan grants nothing (then there is no limit to be near).
 */
const limitOf = (balance: AutumnBalance): number | null => {
	if (balance.unlimited === true) return null
	const granted = balance.granted ?? null
	return granted != null && granted > 0 ? granted : null
}

/**
 * A customer's feature usage for `at`'s day: one metric per balance, declared as it is written.
 * The definition op is idempotent (ingest leaves an unchanged row alone), so a delivery that
 * never ran the pull's feature phase still names the metric after the feature.
 */
export const balanceOps = (
	customer: AutumnCustomer & { readonly id: string },
	options: { readonly names?: ReadonlyMap<string, string>; readonly at: Date },
): Array<IngestOp> => {
	const names = options.names ?? new Map<string, string>()
	const day = dayOf(options.at)
	const ops: Array<IngestOp> = []
	for (const balance of Object.values(customer.balances ?? {})) {
		// A boolean flag has no number behind it; Autumn keeps those under `flags`, not `balances`.
		if (balance.feature_id.trim() === "") continue
		const usage = balance.usage ?? null
		if (usage === null || !Number.isFinite(usage)) continue
		const key = metricKeyOf(balance.feature_id)
		const name = nameOf(balance, names)
		if (name !== null) ops.push(definitionOf(key, name))
		const metric: Types.Mutable<RecordMetric> = {
			_tag: "metric",
			account: autumnRef(customer.id),
			metricKey: key,
			day,
			value: Math.max(0, usage),
		}
		metric.limitValue = limitOf(balance)
		ops.push(metric)
	}
	return ops
}

/** A customer, then its usage: ingest needs the account before a metric names it. */
export const customerOps = (
	customer: AutumnCustomer & { readonly id: string },
	options: {
		readonly config: ConnectionConfig
		readonly env: AutumnEnv
		readonly names?: ReadonlyMap<string, string>
		readonly at: Date
		readonly observedAt: IsoTimestamp
	},
): Array<IngestOp> => [
	accountOp(customer, options.config, options.env, options.observedAt),
	...balanceOps(customer, { names: options.names, at: options.at }),
]

// ---------------------------------------------------------------------------
// Usage events
// ---------------------------------------------------------------------------

/** What a usage entry carries in its `data`, so the timeline can say which limit and which feature. */
type UsageEventData = {
	readonly featureId: string
	readonly metricKey: string
	limitType?: string
	threshold?: number
	thresholdType?: string
}

const LIMIT_LABEL: ReadonlyMap<string, string> = new Map([
	["included", "its included allowance"],
	["max_purchase", "its purchase cap"],
	["spend_limit", "its spend limit"],
	["usage_limit", "its usage cap"],
])

/**
 * A feature limit reached, or a usage alert crossed. Deduped on the delivery's own id (Svix's
 * `svix-id` for the event types Autumn sends no id with), so a redelivery writes one entry.
 */
export const usageEventOp = (
	event: AutumnBalanceEvent,
	options: {
		readonly kind: "limit_reached" | "usage_alert"
		readonly deliveryId: string
		readonly occurredAt: IsoTimestamp
		readonly names?: ReadonlyMap<string, string>
	},
): RecordEvent => {
	const feature = options.names?.get(event.feature_id) ?? event.feature_id
	const alert = event.usage_alert ?? null
	const threshold = alert?.threshold ?? null
	const title =
		options.kind === "limit_reached"
			? `${feature} reached ${LIMIT_LABEL.get(event.limit_type ?? "") ?? "its plan limit"}`
			: `${feature} crossed ${threshold === null ? "a usage alert" : `the ${threshold}${alert?.threshold_type === "usage_percentage" ? "%" : ""} usage alert`}`
	const data: UsageEventData = {
		featureId: event.feature_id,
		metricKey: metricKeyOf(event.feature_id),
	}
	if (event.limit_type != null) data.limitType = event.limit_type
	if (threshold !== null) data.threshold = threshold
	if (alert?.threshold_type != null) data.thresholdType = alert.threshold_type
	return {
		_tag: "event",
		externalId: `${options.kind}:${options.deliveryId}`,
		account: autumnRef(event.customer_id),
		type: options.kind === "limit_reached" ? "usage.limit_reached" : "usage.limit_approaching",
		title,
		data,
		occurredAt: options.occurredAt,
	}
}

/** Feature id → display name, for metric definitions and event titles. */
export const featureNamesOf = (
	features: ReadonlyArray<{ readonly id: string; readonly name?: string | null }>,
): Map<string, string> =>
	new Map(
		features.flatMap((feature) => {
			const name = feature.name?.trim() ?? ""
			return name === "" ? [] : [[feature.id, name] as const]
		}),
	)

/** The active version of each plan, which is the one Hazel prices from. */
export const plansById = (plans: ReadonlyArray<AutumnPlan>): Map<string, AutumnPlan> => {
	const byId = new Map<string, AutumnPlan>()
	for (const plan of plans) {
		const held = byId.get(plan.id)
		if (held === undefined || (plan.active === true && held.active !== true)) byId.set(plan.id, plan)
	}
	return byId
}

/** The metric definitions a pull declares up front, one per metered feature. */
export const featureDefinitionOps = (
	features: ReadonlyArray<{
		readonly id: string
		readonly name?: string | null
		readonly type?: string | null
	}>,
): Array<DefineMetric> =>
	features.flatMap((feature) =>
		feature.type === "boolean" || feature.id.trim() === ""
			? []
			: [
					{
						_tag: "metric_definition" as const,
						key: metricKeyOf(feature.id),
						name: feature.name?.trim() || feature.id,
						unit: null,
						aggregation: "max" as const,
						description: null,
					},
				],
	)
