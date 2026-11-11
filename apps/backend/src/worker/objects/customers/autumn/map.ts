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
 * - **Recurring plan → subscription**, with MRR normalized to a monthly amount in the currency's
 *   minor units ({@link subscriptionMrr}). Autumn quotes plan amounts in *major* units of the
 *   organization's default currency, so the amount is scaled by that currency's minor-unit factor.
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
 *   `scheduled` plans (not billing yet, and Hazel's model has no scheduled status).
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

/** A deleted customer, dated by the read: ingest keeps an op observed at or before it from reviving it. */
export const accountDeletedOp = (customerId: string, observedAt?: IsoTimestamp): UpsertAccount => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: customerId,
		sameAs: [],
		onNoMatch: "unmatched",
		deleted: true,
	}
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
 * recording it as active would count a future plan's amount as MRR today. The downgrade it
 * usually belongs to is already visible as `cancelAtPeriodEnd` on the plan it replaces.
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

export interface SubscriptionMrr {
	/** Monthly recurring amount in minor units of `currency`. */
	readonly monthlyMinor: number
	/** Plan items Autumn prices by usage or by prepaid units: counted as nothing (see the docs). */
	readonly unpricedItems: number
}

/**
 * A subscription's MRR: the plan's base price × the subscription's quantity, normalized to a month
 * and converted from Autumn's major units to the currency's minor ones. Rounded once, at the end,
 * and never below zero (ingest refuses a negative amount).
 *
 * What is *not* in it: a plan's per-feature item prices. A `usage_based` one bills after the
 * included units and its amount is not knowable in advance (Stripe's metered prices are left out
 * the same way), and a `prepaid` one bills for units Autumn reports on the customer's balances
 * rather than on the subscription. A plan with no base price at all (a free plan, a usage-only
 * one) is MRR 0, which is what it bills today.
 */
export const subscriptionMrr = (
	subscription: AutumnSubscription,
	plan: AutumnPlan | undefined,
	currency: string,
): SubscriptionMrr => {
	const price = plan?.price ?? null
	const factor = price === null ? null : monthlyFactorOf(price)
	const amount = price?.amount ?? null
	const quantity = Math.max(1, Math.round(subscription.quantity ?? 1))
	const monthly =
		amount === null || factor === null ? 0 : amount * factor * quantity * minorUnitsOf(currency)
	return {
		monthlyMinor: Math.max(0, Math.round(monthly)),
		unpricedItems: (plan?.items ?? []).filter((item) => item.price != null).length,
	}
}

/**
 * A recurring plan, read at `observedAt` (ingest drops a read older than one it applied). Null for
 * one Hazel does not record: an entity-scoped plan, a `scheduled` one, or a row whose customer
 * Autumn did not name.
 */
export const subscriptionOp = (
	subscription: AutumnSubscription,
	options: {
		readonly customerId?: string
		readonly plans?: ReadonlyMap<string, AutumnPlan>
		readonly currency: string
		readonly observedAt?: IsoTimestamp
	},
): UpsertSubscription | null => {
	const customerId = subscription.customer_id ?? options.customerId ?? null
	const status = statusOf(subscription)
	if (customerId === null || status === null || isEntityScoped(subscription)) return null
	const plan = options.plans?.get(subscription.plan_id)
	const mrr = subscriptionMrr(subscription, plan, options.currency)
	const expired = status === "canceled"
	const op: Types.Mutable<UpsertSubscription> = {
		_tag: "subscription",
		externalId: subscription.id,
		account: autumnRef(customerId),
		planName: plan?.name ?? subscription.plan_id,
		status,
		mrrMinor: mrr.monthlyMinor,
		// Autumn exposes no per-customer discount on a subscription, so the list price is the price.
		listMrrMinor: mrr.monthlyMinor,
		currency: options.currency.toLowerCase(),
		interval: billingIntervalOf(plan),
		quantity: Math.max(1, Math.round(subscription.quantity ?? 1)),
		startedAt: isoOf(subscription.started_at),
		trialEndsAt: isoOf(subscription.trial_ends_at),
		currentPeriodEnd: isoOf(subscription.current_period_end ?? subscription.expires_at),
		// A cancellation Autumn has recorded but not yet carried out: the plan runs to `expires_at`.
		cancelAtPeriodEnd: !expired && subscription.canceled_at != null,
		canceledAt: isoOf(subscription.canceled_at ?? (expired ? subscription.expires_at : null)),
	}
	if (options.observedAt !== undefined) op.observedAt = options.observedAt
	return op
}

// ---------------------------------------------------------------------------
// Balances → metrics
// ---------------------------------------------------------------------------

/**
 * The feature's own name, when this read carries one. `customers.list` takes no `expand`, so a
 * pulled balance has none and the definition is left to the walk's feature phase (or, for a feature
 * added since, to ingest, which names it after the key until that phase runs again). A definition is
 * never written from a name Hazel had to guess: it would overwrite the real one.
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
): RecordEvent | null => {
	// An entity's limit is a sub-customer's, not the account's.
	if (event.entity_id != null && event.entity_id !== "") return null
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
