/**
 * Stripe records → `IngestOp`s (`docs/customers/tech-design.md` §3). Pure: webhooks and pulls both
 * come through here, so one mapping is tested once.
 *
 * The shape of the mapping:
 *
 * - **Customer → account.** Stripe is a billing source, not an identity one: a customer never
 *   creates a customer record on its own (`onNoMatch: "unmatched"`). It lands on an account through
 *   a shared id — the Clerk organization id in the customer's metadata — or, when the connection
 *   allows it and there is no shared id, through the domain of the customer's email. Everything else waits in the unmatched
 *   list for a human to link, and ingest replays it then.
 * - **Customer email → billing contact.** One contact per customer, keyed on the customer id, with
 *   `isBillingContact`. Ingest matches it to the account's existing contact with that email (the
 *   Clerk member, usually) instead of adding a second row for the same person.
 * - **Subscription → subscription**, with MRR normalized to a monthly amount in the currency's
 *   minor units ({@link monthlyMrrOf}). `mrrMinor` is what the subscription bills (or would bill)
 *   whatever its status: compute decides which statuses count towards an account's MRR, and reads a
 *   canceled subscription's amount to recognise churn.
 * - **Invoice → invoice**, with the amounts, the dates and the hosted copy's URL.
 * - **Timeline events** are ingest's: it raises `subscription.started`, `subscription.plan_changed`,
 *   `subscription.canceled`, `subscription.cancel_scheduled`, `invoice.paid` and
 *   `invoice.payment_failed` from the state changes these ops describe, so the adapter adds none.
 * - **Ordering.** Account and contact ops carry `observedAt`, the time Hazel read the customer
 *   (every event re-reads its object, `./webhook.ts`; Stripe customers have no `updated` of their
 *   own), so a late delivery cannot revive a customer deleted since.
 */
import type {
	ConnectionConfig,
	IngestOp,
	IsoTimestamp,
	ProviderRef,
	SubscriptionStatus,
	UpsertAccount,
	UpsertContact,
	UpsertInvoice,
	UpsertSubscription,
} from "@hazel/domain/customers"
import type { Types } from "effect"
import {
	couponsOf,
	customerUrlOf,
	idOf,
	invoiceSubscriptionIdOf,
	isClerkOrgId,
	isoOf,
	metadataOf,
	objectOf,
	periodEndOf,
	priceOf,
	type StripeCustomer,
	type StripeInvoice,
	type StripePrice,
	type StripeSubscription,
	type StripeSubscriptionItem,
} from "./wire"

export const stripeRef = (externalId: string): ProviderRef => ({ provider: "stripe", externalId })

const clerkRef = (externalId: string): ProviderRef => ({ provider: "clerk", externalId })

/** Whether this connection may land a customer on an account by the domain of its email. */
export const matchesByDomain = (config: ConnectionConfig): boolean =>
	config._tag !== "stripe" || config.matchByDomain

/**
 * The metadata key Autumn writes the Autumn customer id under on the Stripe customers it creates
 * (Autumn's `createStripeCustomer`). That id is the Clerk organization id when Autumn is keyed by
 * it (`connections.ts`, `AutumnConnectionConfig`), which is what makes an Autumn-managed Stripe
 * account match with no configuration.
 */
const AUTUMN_ID_KEY = "autumn_id"

/**
 * The Clerk organization id a customer's metadata names: the value under the configured key
 * (`clerk_org_id` by default); without one, Autumn's `autumn_id` when it is shaped like a Clerk
 * organization id. Nothing else in the metadata is read, so an `org_…` value some other tool wrote
 * cannot link the customer to the wrong account.
 */
export const clerkOrgIdsOf = (customer: StripeCustomer, config: ConnectionConfig): ReadonlyArray<string> => {
	const entries = new Map(metadataOf(customer.metadata))
	const key = config._tag === "stripe" ? config.clerkOrgMetadataKey.trim() : ""
	const configured = key === "" ? undefined : entries.get(key)
	if (configured !== undefined) return [configured]
	const autumn = entries.get(AUTUMN_ID_KEY)
	return autumn !== undefined && isClerkOrgId(autumn) ? [autumn] : []
}

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

/**
 * A customer. `observedAt` orders it against a deletion. The email's domain is a match key, not a
 * fact about the account (a billing email is often an accountant's or a founder's own): it is sent
 * only while the connection matches by domain and the customer names no shared id, so a customer
 * placed by its Clerk organization id never teaches the account a domain. One matched by domain
 * already has it.
 */
export const accountOp = (
	customer: StripeCustomer,
	config: ConnectionConfig,
	observedAt?: IsoTimestamp,
): UpsertAccount => {
	const op: Types.Mutable<UpsertAccount> = {
		_tag: "account",
		externalId: customer.id,
		externalUrl: customerUrlOf(customer.id, customer.livemode),
		sameAs: clerkOrgIdsOf(customer, config).map(clerkRef),
		// Billing sources never invent a customer: an unmatched one waits for a human.
		onNoMatch: "unmatched",
	}
	// Absent must not clear what another source established.
	if (customer.name != null && customer.name.trim() !== "") op.name = customer.name.trim()
	const domain = matchesByDomain(config) && op.sameAs.length === 0 ? emailDomainOf(customer.email) : null
	if (domain !== null) {
		op.domains = [domain]
		op.matchByDomain = true
	}
	const createdAt = isoOf(customer.created)
	if (createdAt !== null) op.createdAt = createdAt
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/** A deleted customer, dated by its event: ingest keeps an op observed at or before it from reviving it. */
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

/**
 * The customer's billing contact, when Stripe has an email for it. Name and avatar stay the
 * identity source's: a Stripe customer's `name` is the company's as often as a person's.
 */
export const billingContactOp = (
	customer: StripeCustomer,
	observedAt?: IsoTimestamp,
): UpsertContact | null => {
	const email = customer.email?.trim() ?? ""
	if (email === "" || !email.includes("@")) return null
	const op: Types.Mutable<UpsertContact> = {
		_tag: "contact",
		externalId: customer.id,
		account: stripeRef(customer.id),
		externalUrl: customerUrlOf(customer.id, customer.livemode),
		email,
		isBillingContact: true,
	}
	if (observedAt !== undefined) op.observedAt = observedAt
	return op
}

/** A customer, then its billing contact: ingest needs the account before the contact names it. */
export const customerOps = (
	customer: StripeCustomer,
	config: ConnectionConfig,
	observedAt?: IsoTimestamp,
): Array<IngestOp> => {
	const contact = billingContactOp(customer, observedAt)
	const account = accountOp(customer, config, observedAt)
	return contact === null ? [account] : [account, contact]
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Stripe's statuses onto Hazel's. `incomplete` (a first payment that never went through) has no
 * equivalent and is not a customer yet: those subscriptions are skipped until they go `active`.
 * `incomplete_expired` is where an `incomplete` one ends, so it was never recorded and is skipped
 * too: recording it would be churn that never was.
 */
const SUBSCRIPTION_STATUS = new Map<string, SubscriptionStatus>([
	["trialing", "trialing"],
	["active", "active"],
	["past_due", "past_due"],
	["unpaid", "unpaid"],
	["paused", "paused"],
	["canceled", "canceled"],
])

export const statusOf = (status: string | null | undefined): SubscriptionStatus | null =>
	status == null ? null : (SUBSCRIPTION_STATUS.get(status) ?? null)

/** How many months one billing period of this price covers, as a multiplier onto a monthly amount. */
const MONTHLY_FACTOR = new Map<string, number>([
	["month", 1],
	["year", 1 / 12],
	["week", 52 / 12],
	["day", 365 / 12],
])

const intervalOf = (price: StripePrice | null): string | null =>
	price === null ? null : (price.recurring?.interval ?? price.interval ?? null)

const intervalCountOf = (price: StripePrice | null): number => {
	const count = price === null ? null : (price.recurring?.interval_count ?? price.interval_count ?? null)
	return count != null && count > 0 ? count : 1
}

/** The monthly share of one period's amount: `/year` is a twelfth, `/week` is 52 weeks over 12. */
const monthlyFactorOf = (price: StripePrice | null): number | null => {
	const interval = intervalOf(price)
	const factor = interval === null ? undefined : MONTHLY_FACTOR.get(interval)
	return factor === undefined ? null : factor / intervalCountOf(price)
}

/** `month` and `year` as they are; a weekly, daily or unknown cadence is `other`. */
export const billingIntervalOf = (price: StripePrice | null): UpsertSubscription["interval"] => {
	const interval = intervalOf(price)
	return interval === "month" || interval === "year" ? interval : "other"
}

const amountMinorOf = (price: StripePrice): number | null => {
	const flat = price.unit_amount ?? price.amount
	if (flat != null) return flat
	const decimal = price.unit_amount_decimal ?? price.amount_decimal
	if (decimal == null) return null
	const parsed = Number(decimal)
	return Number.isFinite(parsed) ? parsed : null
}

/**
 * One item's monthly amount in minor units, or null when Stripe does not say what it costs: a
 * metered price bills by usage, and a tiered one keeps its amounts on the tiers, not the price.
 * Minor units are passed through untouched, so a zero-decimal currency (¥5000 = `5000`) is right.
 */
export const itemMonthlyMinor = (item: StripeSubscriptionItem): number | null => {
	const price = priceOf(item)
	if (price === null) return null
	const usage = price.recurring?.usage_type ?? price.usage_type ?? null
	if (usage === "metered") return null
	if (price.billing_scheme === "tiered") return null
	const amount = amountMinorOf(price)
	const factor = monthlyFactorOf(price)
	if (amount === null || factor === null) return null
	const quantity = item.quantity ?? 1
	return amount * quantity * factor
}

export interface SubscriptionMrr {
	/** Monthly recurring amount in minor units, discounts applied. */
	readonly mrrMinor: number
	/** The same before discounts: what the plan lists (`trialListMrrMinor` sums these for trials). */
	readonly listMrrMinor: number
	/** The item that carries most of the amount: its price names the plan, interval and quantity. */
	readonly primary: StripeSubscriptionItem | null
	readonly currency: string
	/** Items whose amount Stripe does not state (metered, tiered): counted as nothing. */
	readonly unpricedItems: number
}

/**
 * A subscription's MRR: every priced item's amount × quantity, normalized to a month, summed, then
 * the subscription's coupons applied — a `percent_off` always, an `amount_off` only in the
 * subscription's own currency, spread over the primary item's cadence. Rounded once, at the end,
 * and never below zero (ingest refuses a negative amount).
 */
export const monthlyMrrOf = (subscription: StripeSubscription): SubscriptionMrr => {
	const items = subscription.items?.data ?? []
	const priced = items.map((item) => ({ item, monthly: itemMonthlyMinor(item) }))
	const list = priced.reduce((sum, entry) => sum + (entry.monthly ?? 0), 0)
	const primary =
		[...priced]
			.filter((entry) => entry.monthly !== null)
			.sort((a, b) => (b.monthly ?? 0) - (a.monthly ?? 0))[0]?.item ??
		items[0] ??
		null
	const currency = (
		subscription.currency ??
		(primary === null ? null : priceOf(primary)?.currency) ??
		"usd"
	).toLowerCase()
	const factor = monthlyFactorOf(primary === null ? null : priceOf(primary)) ?? 1
	let discounted = list
	for (const coupon of couponsOf(subscription)) {
		if (coupon.percent_off != null) discounted *= 1 - coupon.percent_off / 100
		if (
			coupon.amount_off != null &&
			(coupon.currency == null || coupon.currency.toLowerCase() === currency)
		) {
			discounted -= coupon.amount_off * factor
		}
	}
	return {
		mrrMinor: Math.max(0, Math.round(discounted)),
		listMrrMinor: Math.max(0, Math.round(list)),
		primary,
		currency,
		unpricedItems: priced.filter((entry) => entry.monthly === null).length,
	}
}

/** The product behind the item that carries the subscription's amount: the plan to name it after. */
export const primaryProductIdOf = (subscription: StripeSubscription): string | null => {
	const primary = monthlyMrrOf(subscription).primary
	return (primary === null ? null : priceOf(primary)?.product) ?? null
}

/**
 * The plan's name: the Stripe product's, which the caller looked up (Stripe's four-level expansion
 * limit keeps it off a subscription list). The price's nickname or lookup key only for a product
 * Stripe did not return at all; a lookup that failed never gets here (`./webhook.ts`, `./pull.ts`).
 */
const planNameOf = (price: StripePrice | null, productNames: ReadonlyMap<string, string>): string | null => {
	if (price === null) return null
	const product = price.product == null ? undefined : productNames.get(price.product)
	return product ?? price.nickname ?? price.lookup_key ?? null
}

/**
 * The card a subscription is charged on: its own default payment method, else its customer's
 * invoice default. Both are expanded wherever a subscription is read (`subscriptionExpands`), so
 * neither being set means there is no card (detached, say) and clears the stored one; an id that
 * was not expanded says nothing and leaves it.
 */
const paymentMethodOf = (subscription: StripeSubscription): UpsertSubscription["paymentMethod"] => {
	const customer = objectOf(subscription.customer)
	const method =
		subscription.default_payment_method ??
		(customer === null ? undefined : customer.invoice_settings?.default_payment_method)
	if (method === undefined || typeof method === "string") return undefined
	if (method === null) return customer === null ? undefined : null
	const card = method.card ?? null
	if (card !== null) {
		return {
			brand: card.brand ?? null,
			last4: card.last4 ?? null,
			expMonth: card.exp_month ?? null,
			expYear: card.exp_year ?? null,
		}
	}
	// A SEPA debit, a Link wallet, a bank account: the type is all there is to show.
	return { brand: method.type ?? null, last4: null, expMonth: null, expYear: null }
}

/**
 * A subscription. Null when its customer or its status is not one Hazel records (an `incomplete`
 * subscription, or a status Stripe added since).
 */
export const subscriptionOp = (
	subscription: StripeSubscription,
	productNames: ReadonlyMap<string, string> = new Map(),
): UpsertSubscription | null => {
	const customerId = idOf(subscription.customer)
	const status = statusOf(subscription.status)
	if (customerId === null || status === null) return null
	const mrr = monthlyMrrOf(subscription)
	const price = mrr.primary === null ? null : priceOf(mrr.primary)
	const details = subscription.cancellation_details
	const op: Types.Mutable<UpsertSubscription> = {
		_tag: "subscription",
		externalId: subscription.id,
		account: stripeRef(customerId),
		planName: planNameOf(price, productNames),
		status,
		mrrMinor: mrr.mrrMinor,
		listMrrMinor: mrr.listMrrMinor,
		currency: mrr.currency,
		interval: billingIntervalOf(price),
		quantity: mrr.primary?.quantity ?? 1,
		startedAt: isoOf(subscription.start_date ?? subscription.created),
		trialEndsAt: isoOf(subscription.trial_end),
		currentPeriodEnd: isoOf(periodEndOf(subscription)),
		// A cancellation set for a date (`cancel_at`) is as scheduled as one at the period's end.
		cancelAtPeriodEnd: subscription.cancel_at_period_end === true || subscription.cancel_at != null,
		canceledAt: isoOf(subscription.canceled_at),
		cancellationReason: details?.reason ?? details?.feedback ?? null,
	}
	const method = paymentMethodOf(subscription)
	if (method !== undefined) op.paymentMethod = method
	return op
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * A `draft` is not recorded: it is not billed yet, nothing reads one, and Stripe deletes drafts
 * (`invoice.deleted`) without a trace a sync could follow. It is recorded once finalized.
 */
const INVOICE_STATUS = new Map<string, UpsertInvoice["status"]>([
	["open", "open"],
	["paid", "paid"],
	["uncollectible", "uncollectible"],
	["void", "void"],
])

export const invoiceStatusOf = (status: string | null | undefined): UpsertInvoice["status"] | null =>
	status == null ? null : (INVOICE_STATUS.get(status) ?? null)

/** What a failed collection records: Stripe keeps its own decline message on the payment intent. */
const FAILED_REASON = "Stripe could not collect this payment"

/**
 * An invoice. Null for one Hazel does not record: a preview with no id yet (`invoice.upcoming`), a
 * draft, an invoice with no customer, or a status Stripe added since.
 *
 * `paymentFailed` marks the op as coming from an `invoice.payment_failed` event about an invoice
 * still open, which is what lets ingest raise the timeline event on the *first* attempt: Hazel does
 * not read the payment intent, so without a reason an `attempt_count` of 1 would look like an
 * ordinary open invoice. Otherwise the decline reason is left as stored, never cleared: a
 * `last_finalization_error` is a finalization problem, not a decline.
 */
export const invoiceOp = (
	invoice: StripeInvoice,
	options: { readonly paymentFailed?: boolean } = {},
): UpsertInvoice | null => {
	const externalId = invoice.id ?? null
	const customerId = idOf(invoice.customer)
	const status = invoiceStatusOf(invoice.status)
	if (externalId === null || customerId === null || status === null) return null
	const transitions = invoice.status_transitions
	const op: Types.Mutable<UpsertInvoice> = {
		_tag: "invoice",
		externalId,
		account: stripeRef(customerId),
		subscriptionExternalId: invoiceSubscriptionIdOf(invoice),
		number: invoice.number ?? null,
		status,
		// Credit balance can push Stripe's amounts below zero, which the store refuses.
		amountDueMinor: Math.max(0, Math.round(invoice.amount_due ?? 0)),
		amountPaidMinor: Math.max(0, Math.round(invoice.amount_paid ?? 0)),
		currency: (invoice.currency ?? "usd").toLowerCase(),
		issuedAt: isoOf(transitions?.finalized_at ?? invoice.created),
		dueAt: isoOf(invoice.due_date),
		paidAt: isoOf(transitions?.paid_at),
		attemptCount: Math.max(0, Math.round(invoice.attempt_count ?? 0)),
		nextRetryAt: isoOf(invoice.next_payment_attempt),
		hostedUrl: invoice.hosted_invoice_url ?? null,
	}
	if (options.paymentFailed === true && status === "open") op.declineReason = FAILED_REASON
	return op
}
